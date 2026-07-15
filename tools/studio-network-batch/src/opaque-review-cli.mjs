import path from "node:path";
import { fileURLToPath } from "node:url";

import { runOpaqueFinalReview } from "./opaque-review.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

runOpaqueFinalReview({ packageRoot })
  .then((result) => {
    process.stdout.write(JSON.stringify({
      focusRoot: result.focusRoot,
      totalUnresolvedOpaqueRecords: result.summary.totalUnresolvedOpaqueRecords,
      classificationCounts: result.summary.classificationCounts,
      pageCount: result.summary.pageCount,
      recordsWithAdditionalReviewReasons: result.summary.recordsWithAdditionalReviewReasons.count,
      recordsWithVerySmallVisibleArtwork: result.summary.recordsWithVerySmallVisibleArtwork.count,
      recordsWhoseOpaqueEdgeCloselyMatchesSelectedBackground:
        result.summary.recordsWhoseOpaqueEdgeCloselyMatchesSelectedBackground.count,
      reviewTemplate: result.paths.reviewTemplate,
      preservation: result.preservation,
    }, null, 2) + "\n");
  })
  .catch((error) => {
    process.stderr.write((error.stack ?? error.message) + "\n");
    process.exitCode = 1;
  });
