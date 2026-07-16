function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateFormat(value, format) {
  if (format === "date-time") {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
      && Number.isFinite(Date.parse(value));
  }
  return true;
}

export function validateAgainstSchema(value, schema, path = "$") {
  const errors = [];
  const add = (message) => errors.push(`${path}: ${message}`);

  if (Object.hasOwn(schema, "const") && !sameValue(value, schema.const)) {
    add(`must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((candidate) => sameValue(value, candidate))) {
    add(`must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(", ")}`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      add(`must have type ${types.join(" or ")}`);
      return errors;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(`must have length at least ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`must have length at most ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) add(`must match ${schema.pattern}`);
    if (schema.format && !validateFormat(value, schema.format)) add(`must have ${schema.format} format`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) add(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`must be at most ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) add("must contain unique items");
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required}: is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        errors.push(...validateAgainstSchema(child, properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateAgainstSchema(child, schema.additionalProperties, `${path}.${key}`));
      }
      if (schema.propertyNames) errors.push(...validateAgainstSchema(key, schema.propertyNames, `${path}.{propertyName}`));
    }
  }

  return errors;
}
