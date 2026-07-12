export class PipelineError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PipelineError";
    this.code = code;
  }
}
