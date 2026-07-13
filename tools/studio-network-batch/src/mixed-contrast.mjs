import path from "node:path";

import { relativeLuminance, parseHexColour } from "./image-analysis.mjs";

function contrastRatio(left, right) {
  const high = Math.max(left, right);
  const low = Math.min(left, right);
  return (high + 0.05) / (low + 0.05);
}

export function weightedQuantile(samples, quantile) {
  if (!samples.length) return 0;
  if (!(quantile >= 0 && quantile <= 1)) throw new Error(`Invalid quantile: ${quantile}`);
  const sorted = [...samples].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  const target = totalWeight * quantile;
  let cumulative = 0;
  for (const sample of sorted) {
    cumulative += sample.weight;
    if (cumulative >= target) return sample.value;
  }
  return sorted.at(-1).value;
}

function metricsAgainstBackground(analysis, background, contrastConfig, alphaThreshold) {
  const backgroundLuminance = relativeLuminance(background);
  const samples = [];
  let totalWeight = 0;
  let weightedContrast = 0;
  const belowWeights = { below1_5: 0, below2: 0, below3: 0, below4_5: 0 };
  let usefulWeight = 0;
  let strongWeight = 0;

  for (let index = 0; index < analysis.normalisedBuffer.length; index += 4) {
    const a = analysis.normalisedBuffer[index + 3];
    if (a < alphaThreshold) continue;
    const alpha = a / 255;
    const composited = {
      r: analysis.normalisedBuffer[index] * alpha + background.r * (1 - alpha),
      g: analysis.normalisedBuffer[index + 1] * alpha + background.g * (1 - alpha),
      b: analysis.normalisedBuffer[index + 2] * alpha + background.b * (1 - alpha),
    };
    const ratio = contrastRatio(relativeLuminance(composited), backgroundLuminance);
    samples.push({ value: ratio, weight: alpha });
    totalWeight += alpha;
    weightedContrast += ratio * alpha;
    if (ratio < 1.5) belowWeights.below1_5 += alpha;
    if (ratio < 2) belowWeights.below2 += alpha;
    if (ratio < 3) belowWeights.below3 += alpha;
    if (ratio < 4.5) belowWeights.below4_5 += alpha;
    if (ratio >= contrastConfig.usefulRatio) usefulWeight += alpha;
    if (ratio >= contrastConfig.strongRatio) strongWeight += alpha;
  }

  const median = weightedQuantile(samples, 0.5);
  const p10 = weightedQuantile(samples, 0.1);
  const atOrAbove3 = totalWeight ? usefulWeight / totalWeight : 0;
  const atOrAbove4_5 = totalWeight ? strongWeight / totalWeight : 0;
  const aggregateScore =
    p10 * 0.45 +
    median * 0.35 +
    atOrAbove3 * 1.25 +
    atOrAbove4_5 * 0.75;
  return {
    average: totalWeight ? weightedContrast / totalWeight : 0,
    median,
    p05: weightedQuantile(samples, 0.05),
    p10,
    p20: weightedQuantile(samples, 0.2),
    below1_5: totalWeight ? belowWeights.below1_5 / totalWeight : 0,
    below2: totalWeight ? belowWeights.below2 / totalWeight : 0,
    below3: totalWeight ? belowWeights.below3 / totalWeight : 0,
    below4_5: totalWeight ? belowWeights.below4_5 / totalWeight : 0,
    atOrAbove3,
    atOrAbove4_5,
    aggregateScore,
    alphaWeight: totalWeight,
    visiblePixelCount: samples.length,
  };
}

export function calculateMixedContrastMetrics(analysis, preset) {
  const threshold = preset.logo.visibleAlphaThreshold;
  return {
    dark: metricsAgainstBackground(analysis, parseHexColour(preset.backgrounds.dark), preset.contrast, threshold),
    light: metricsAgainstBackground(analysis, parseHexColour(preset.backgrounds.light), preset.contrast, threshold),
  };
}

function alternativeBackground(background) {
  return background === "dark" ? "light" : "dark";
}

function switchDecision(currentBackground, ruleId, reason) {
  return { decision: "switch", selectedBackground: alternativeBackground(currentBackground), ruleId, reason };
}

function unchangedDecision(currentBackground, ruleId, reason = "guard-not-met") {
  return { decision: "unchanged", selectedBackground: currentBackground, ruleId, reason };
}

export function applyMixedContrastRule(metrics, currentBackground, rule, context = {}) {
  const current = metrics[currentBackground];
  const alternativeName = alternativeBackground(currentBackground);
  const alternative = metrics[alternativeName];
  const aggregateLoss = current.aggregateScore - alternative.aggregateScore;
  const usefulLoss = current.atOrAbove3 - alternative.atOrAbove3;
  const below2Improvement = current.below2 - alternative.below2;

  if (rule.type === "baseline") return unchangedDecision(currentBackground, rule.id, "current-aggregate-baseline");
  if (rule.type === "lower-percentile") {
    const passes = current[rule.percentile] < rule.selectedFloor &&
      alternative[rule.percentile] >= current[rule.percentile] + rule.minimumAlternativeGain &&
      alternative.aggregateScore >= rule.minimumAlternativeAggregate;
    return passes
      ? switchDecision(currentBackground, rule.id, `${rule.percentile}-floor-and-alternative-gain`)
      : unchangedDecision(currentBackground, rule.id);
  }
  if (rule.type === "low-share") {
    const passes = current[rule.metric] >= rule.selectedShare &&
      current[rule.metric] - alternative[rule.metric] >= rule.minimumShareImprovement &&
      usefulLoss <= rule.maximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.minimumAlternativeAggregate;
    return passes
      ? switchDecision(currentBackground, rule.id, `${rule.metric}-share-materially-improved`)
      : unchangedDecision(currentBackground, rule.id);
  }
  if (rule.type === "meaningful-alternative") {
    const passes = current.below2 >= rule.selectedBelow2 &&
      below2Improvement >= rule.minimumBelow2Improvement &&
      usefulLoss <= rule.maximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.minimumAlternativeAggregate &&
      aggregateLoss <= rule.maximumAggregateLoss;
    return passes
      ? switchDecision(currentBackground, rule.id, "alternative-materially-improves-below-2-share")
      : unchangedDecision(currentBackground, rule.id);
  }
  if (rule.type === "hybrid") {
    const automatic = current.below2 >= rule.selectedBelow2 &&
      below2Improvement >= rule.minimumBelow2Improvement &&
      usefulLoss <= rule.maximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.minimumAlternativeAggregate &&
      aggregateLoss <= rule.maximumAggregateLoss &&
      current.p20 <= rule.selectedP20Ceiling;
    if (automatic) return switchDecision(currentBackground, rule.id, "hybrid-low-tail-and-meaningful-improvement");
    const review = current.below2 >= rule.reviewSelectedBelow2 &&
      below2Improvement >= rule.reviewMinimumBelow2Improvement &&
      usefulLoss <= rule.reviewMaximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.reviewMinimumAlternativeAggregate;
    if (review) {
      return { decision: "review-only", selectedBackground: currentBackground, ruleId: rule.id, reason: "broader-hybrid-review-guard" };
    }
    return unchangedDecision(currentBackground, rule.id);
  }
  if (rule.type === "mixed-dark-component") {
    if (currentBackground !== "dark") return unchangedDecision(currentBackground, rule.id, "rule-targets-dark-selection");
    const balancedComponent = current.below3 >= rule.selectedBelow3Minimum &&
      current.below3 <= rule.selectedBelow3Maximum;
    const automatic = balancedComponent &&
      current.p10 <= rule.selectedP10Maximum &&
      current.below1_5 - alternative.below1_5 >= rule.minimumBelow1_5Improvement &&
      alternative.p10 >= rule.minimumAlternativeP10 &&
      alternative.atOrAbove3 >= rule.minimumAlternativeAtOrAbove3 &&
      usefulLoss <= rule.maximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.minimumAlternativeAggregate &&
      !context.unexpectedlyOpaque;
    if (automatic) return switchDecision(currentBackground, rule.id, "substantial-dark-component-with-viable-light-alternative");
    const broadReview = balancedComponent &&
      current.p10 <= rule.selectedP10Maximum &&
      alternative.atOrAbove3 >= rule.minimumAlternativeAtOrAbove3 &&
      usefulLoss <= rule.maximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.minimumAlternativeAggregate;
    if (broadReview) {
      return { decision: "review-only", selectedBackground: alternativeName, ruleId: rule.id, reason: context.unexpectedlyOpaque ? "opaque-source-requires-review" : "mixed-dark-component-requires-review" };
    }
    const review = balancedComponent &&
      current.p10 >= rule.reviewP10Minimum &&
      current.p10 <= rule.reviewP10Maximum &&
      current.below2 <= rule.reviewMaximumBelow2 &&
      usefulLoss <= rule.reviewMaximumAtOrAbove3Loss &&
      alternative.aggregateScore >= rule.reviewMinimumAlternativeAggregate;
    if (review) {
      return { decision: "review-only", selectedBackground: currentBackground, ruleId: rule.id, reason: "substantial-near-threshold-dark-component" };
    }
    return unchangedDecision(currentBackground, rule.id);
  }
  throw new Error(`Unknown mixed-contrast rule type: ${rule.type}`);
}

export function stableKeyParts(stableKey) {
  const match = /^(company|network):(\d+)$/.exec(stableKey);
  if (!match) throw new Error(`Invalid stable key: ${stableKey}`);
  return { entityType: match[1], tmdbId: Number(match[2]) };
}

export function compareStableKeys(left, right) {
  const a = stableKeyParts(typeof left === "string" ? left : left.stableKey);
  const b = stableKeyParts(typeof right === "string" ? right : right.stableKey);
  return (a.entityType === b.entityType ? 0 : a.entityType === "company" ? -1 : 1) || a.tmdbId - b.tmdbId;
}

export function experimentRenderPath(packageRoot, group, stableKey, variant) {
  const { entityType, tmdbId } = stableKeyParts(stableKey);
  const safeVariant = new Set(["current", "forced-dark", "forced-light", "proposed-rule"]);
  if (!safeVariant.has(variant)) throw new Error(`Invalid experiment variant: ${variant}`);
  if (!new Set(["candidates", "controls", "projected"]).has(group)) throw new Error(`Invalid experiment group: ${group}`);
  return path.join(
    packageRoot,
    ".work",
    "experiments",
    "mixed-contrast-v1",
    "renders",
    group,
    `${entityType}-${tmdbId}-${variant}.webp`,
  );
}

export function summariseProjectedImpact(records) {
  return {
    totalLogoBearing: records.length,
    unchanged: records.filter((record) => record.proposedDecision === "unchanged").length,
    switchDarkToLight: records.filter((record) => record.proposedDecision === "switch" && record.currentSelectedBackground === "dark" && record.proposedSelectedBackground === "light").length,
    switchLightToDark: records.filter((record) => record.proposedDecision === "switch" && record.currentSelectedBackground === "light" && record.proposedSelectedBackground === "dark").length,
    reviewOnly: records.filter((record) => record.proposedDecision === "review-only").length,
  };
}
