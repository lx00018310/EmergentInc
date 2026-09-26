export interface InputValidationIssue {
  path: string;
  message: string;
}

export class InputValidationError extends Error {
  constructor(public readonly code: string, public readonly errors: InputValidationIssue[]) {
    super(`${code}: ${errors.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "InputValidationError";
  }
}
