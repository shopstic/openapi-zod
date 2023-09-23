import { OpenapiRouteConfig } from "../types/shared.ts";
import { ZodArray, ZodDefault, ZodEffects, ZodNullable, ZodOptional, ZodType } from "../zod.ts";

export type OpenapiRequestQueryKeySchema = {
  key: string;
  schema: ZodType;
  isArray: boolean;
};

export function extractRequestParamsSchema<C extends OpenapiRouteConfig>(
  config: C,
): [string, ZodType][] | undefined {
  const record = config.request?.params;
  return record !== undefined ? Object.entries(record) : undefined;
}

function unwrapZodType(schema: ZodType): ZodType {
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return unwrapZodType(schema.unwrap());
  }

  if (schema instanceof ZodDefault) {
    return unwrapZodType(schema._def.innerType);
  }

  if (
    schema instanceof ZodEffects &&
    schema._def.effect.type === "refinement"
  ) {
    return unwrapZodType(schema._def.schema);
  }

  return schema;
}

export function extractRequestQuerySchema<C extends OpenapiRouteConfig>(
  config: C,
): OpenapiRequestQueryKeySchema[] | undefined {
  const record = config.request?.query;
  return record !== undefined
    ? Object.entries(record).map(([key, schema]) => ({
      key,
      schema,
      isArray: unwrapZodType(schema) instanceof ZodArray,
    }))
    : undefined;
}

export function extractRequestHeadersSchema<C extends OpenapiRouteConfig>(
  config: C,
): [string, ZodType][] | undefined {
  const record = config.request?.headers;
  return record !== undefined ? Object.entries(record) : undefined;
}

export function extractRequestBodySchema<C extends OpenapiRouteConfig>(config: C): ZodType | undefined {
  const bodyContent = config.request?.body?.content;

  if (bodyContent) {
    const schema = bodyContent["application/json"]?.schema;

    if (schema instanceof ZodType) {
      return schema;
    }
  }
}
