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

function resolveLocalReference(schema, rootSchema) {
  if (!schema.$ref) return schema;
  if (!schema.$ref.startsWith("#/")) throw new Error(`Unsupported schema reference ${schema.$ref}`);
  return schema.$ref.slice(2).split("/").reduce((current, segment) => {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || !Object.hasOwn(current, key)) throw new Error(`Unresolved schema reference ${schema.$ref}`);
    return current[key];
  }, rootSchema);
}

export function validateAgainstSchema(value, schema, valuePath = "$", rootSchema = schema) {
  const errors = [];
  schema = resolveLocalReference(schema, rootSchema);
  const add = (message) => errors.push(`${valuePath}: ${message}`);

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
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) add(`must match ${schema.pattern}`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) add(`must be at least ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) add("must contain unique items");
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...validateAgainstSchema(item, schema.items, `${valuePath}[${index}]`, rootSchema)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) add(`must contain at least ${schema.minProperties} properties`);
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${valuePath}.${required}: is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        errors.push(...validateAgainstSchema(child, properties[key], `${valuePath}.${key}`, rootSchema));
      } else if (schema.additionalProperties === false) {
        errors.push(`${valuePath}.${key}: additional property is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateAgainstSchema(child, schema.additionalProperties, `${valuePath}.${key}`, rootSchema));
      }
      if (schema.propertyNames) errors.push(...validateAgainstSchema(key, schema.propertyNames, `${valuePath}.{propertyName}`, rootSchema));
    }
  }

  return errors;
}
