// deno-lint-ignore-file no-explicit-any
export class ZodToOpenapiError {
  constructor(private message: string) {}
}

interface ConflictErrorProps {
  key: string;
  values: any[];
}

export class ConflictError extends ZodToOpenapiError {
  constructor(message: string, private data: ConflictErrorProps) {
    super(message);
  }
}
interface MissingParameterDataErrorProps {
  paramName?: string;
  missingField: string;
}

export class MissingParameterDataError extends ZodToOpenapiError {
  constructor(private data: MissingParameterDataErrorProps) {
    super(
      `Missing parameter data, please specify \`${data.missingField}\` and other OpenAPI parameter props using the \`param\` field of \`ZodSchema.openapi\``,
    );
  }
}

interface UnknownZodTypeErrorProps {
  schemaName?: string;
  currentSchema: any;
}

export class UnknownZodTypeError extends ZodToOpenapiError {
  constructor(private data: UnknownZodTypeErrorProps) {
    super(
      `Unknown zod object type, please specify \`type\` and other OpenAPI props using \`ZodSchema.openapi\`.`,
    );
  }
}
