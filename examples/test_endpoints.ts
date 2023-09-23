import { zsBoolean, zsDate, zsNumber } from "../src/mod.ts";
import { defineOpenapiEndpoint, defineOpenapiJsonEndpoint, OpenapiEndpoints } from "../src/openapi_endpoint.ts";
import { OpenapiRegistry } from "../src/openapi_registry.ts";
import { z } from "../src/zod.ts";

export const registry = new OpenapiRegistry();
export const DateTime = registry.register(
  "DateTime",
  zsDate(z.date().openapi({ type: "string", format: "date-time" })),
);
export const UserSchema = registry.register(
  "User",
  z.object({
    id: zsNumber(z.number().int().min(1).max(9999)).openapi({ example: 1212121 }),
    name: z.string().openapi({ example: "John Doe" }),
    age: z.number().min(1).max(200).openapi({ example: 42 }),
    gender: z.union([z.literal("male"), z.literal("female"), z.literal("unknown")]),
    weapon: z.discriminatedUnion("type", [
      z.object({ type: z.literal("a"), a: z.string() }),
      z.object({ type: z.literal("b"), b: z.string() }),
    ]),
  }),
);

export const InternalErrorSchema = registry.register(
  "InternalError",
  z.object({
    error: z.boolean(),
    message: z.string(),
  }),
);

export const NotFoundError = registry.register(
  "NotFoundError",
  z.object({
    error: z.boolean(),
    message: z.string(),
  }),
);

const alivezEndpoint = defineOpenapiEndpoint({
  method: "get",
  path: "/alivez",
  summary: "Liveness check",
  responses: {
    200: {
      description: "OK",
      headers: {
        "X-RateLimit-Limit": {
          schema: zsNumber(z.number().int().positive()),
          description: "Request limit per hour.",
        },
        "X-RateLimit-Remaining": {
          schema: zsNumber(z.number().int().positive()),
          description: "The number of requests left for the time window.",
        },
        "X-RateLimit-Reset": {
          schema: DateTime,
          description: "The UTC date/time at which the current rate limit window resets.",
        },
      },
      content: {
        "text/plain": {
          schema: z.literal("OK"),
        },
        "application/json": {
          schema: z.object({
            isOk: z.boolean(),
          }),
        },
      },
    },
  },
});

const healthzEndpoint = defineOpenapiEndpoint({
  method: "get",
  path: "/healthz",
  summary: "Health check",
});

const probingEndpoints = new OpenapiEndpoints()
  .endpoint(alivezEndpoint)
  .endpoint(healthzEndpoint);

const getUserByIdEndpoint = defineOpenapiJsonEndpoint({
  method: "get",
  path: "/users/{id}",
  summary: "Get a single user",
  request: {
    params: { id: zsNumber(z.number().int().max(999)) },
  },
  response: {
    description: "Object with user data.",
    body: UserSchema,
  },
});

const updateUserByIdEndpoint = defineOpenapiJsonEndpoint({
  method: "put",
  path: "/users/{id}",
  summary: "Update a single user",
  request: {
    params: {
      id: zsNumber(z.number().int()),
    },
    query: {
      dryRun: zsBoolean(z.boolean()),
      dates: z.array(zsDate(z.date().openapi({ type: "string", format: "date-time" }))).optional(),
    },
    headers: {
      "x-some-uuid": z.string().uuid().min(1),
      "x-some-date": DateTime,
    },
    body: UserSchema,
  },
  response: {
    description: "Object with user data.",
    body: UserSchema,
  },
});

const replaceUserByIdEndpoint = defineOpenapiEndpoint({
  method: "post",
  path: "/users/{id}",
  summary: "Update a single user",
  request: {
    params: { id: zsNumber(z.number().int()) },
    query: { dryRun: zsBoolean(z.boolean()) },
    headers: {
      "x-some-uuid": z.string().uuid().min(1),
      "x-some-date": DateTime,
    },
    body: {
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Object with user data.",
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },
    201: {
      description: "Object with user data.",
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },
    400: {
      description: "Access denied",
      content: {
        "text/plain": {
          schema: z.literal("Access denied"),
        },
      },
    },
    404: {
      description: "The user is not found",
      content: {
        "application/json": {
          schema: NotFoundError,
        },
      },
    },
  },
});

const userEndpoints = new OpenapiEndpoints()
  .endpoint(getUserByIdEndpoint)
  .endpoint(updateUserByIdEndpoint)
  .endpoint(replaceUserByIdEndpoint)
  .endpoint({
    method: "get",
    path: "/download/{fileName}.pdf",
    summary: "Download a PDF file",
    request: {
      params: {
        fileName: z.string().min(1),
      },
    },
    responses: {
      200: {
        description: "The file",
        content: {
          "application/pdf": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
        },
      },
    },
  });

export const endpoints = probingEndpoints.merge(userEndpoints);
