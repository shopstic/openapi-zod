import { OpenapiGenerator } from "./openapi_generator.ts";
import { OpenapiRegistry } from "./openapi_registry.ts";
import { z } from "./zod.ts";
import { assertEquals } from "https://deno.land/std@0.200.0/assert/assert_equals.ts";
import { zsBoolean, zsDate, zsNumber } from "./zod_string_like.ts";

Deno.test("Generate OpenAPI docs", () => {
  const registry = new OpenapiRegistry();

  const SwordSchema = registry.register(
    "Sword",
    z.object({
      type: z.literal("sword"),
      sword: z.object({
        sharpness: z.number().min(1).max(10),
      }),
    }),
  );

  const UserSchema = registry.register(
    "User",
    z.object({
      id: zsNumber(z.number().int().min(1).max(9999).openapi({ example: 1212121 })),
      name: z.string().openapi({ example: "John Doe" }),
      age: z.number().min(1).max(200).openapi({ example: 42 }),
      gender: z.enum(["male", "female", "unknown"]),
      weapon: z.discriminatedUnion("type", [
        SwordSchema,
        z.object({ type: z.literal("bow"), bow: z.object({ range: z.number() }) }),
      ]),
    }),
  );

  const NotFoundError = registry.register(
    "NotFoundError",
    z.object({
      error: z.boolean(),
      message: z.string(),
    }),
  );

  const DateTime = registry.register(
    "DateTime",
    zsDate(z.date().openapi({ type: "string", format: "date-time" })),
  );

  registry.registerPath({
    method: "post",
    path: "/users/{id}",
    summary: "Update a single user",
    request: {
      params: {
        id: zsNumber(z.number().int().positive()).describe("The user ID, must be a positive integer"),
      },
      query: {
        dryRun: zsBoolean(z.boolean()),
      },
      headers: {
        "x-some-uuid": z.string().uuid().min(1).describe("Some UUID"),
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

  const generator = new OpenapiGenerator(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Test",
      version: "1.0.0",
    },
  });

  assertEquals(document, {
    openapi: "3.0.0",
    info: {
      title: "Test",
      version: "1.0.0",
    },
    components: {
      schemas: {
        Sword: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["sword"],
            },
            sword: {
              type: "object",
              properties: {
                sharpness: {
                  type: "number",
                  minimum: 1,
                  maximum: 10,
                },
              },
              required: ["sharpness"],
            },
          },
          required: ["type", "sword"],
        },
        User: {
          type: "object",
          properties: {
            id: {
              type: "integer",
              minimum: 1,
              maximum: 9999,
              example: 1212121,
            },
            name: {
              type: "string",
              example: "John Doe",
            },
            age: {
              type: "number",
              minimum: 1,
              maximum: 200,
              example: 42,
            },
            gender: {
              type: "string",
              enum: ["male", "female", "unknown"],
            },
            weapon: {
              oneOf: [
                {
                  $ref: "#/components/schemas/Sword",
                },
                {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["bow"],
                    },
                    bow: {
                      type: "object",
                      properties: {
                        range: {
                          type: "number",
                        },
                      },
                      required: ["range"],
                    },
                  },
                  required: ["type", "bow"],
                },
              ],
              discriminator: {
                propertyName: "type",
              },
            },
          },
          required: ["id", "name", "age", "gender", "weapon"],
        },
        NotFoundError: {
          type: "object",
          properties: {
            error: {
              type: "boolean",
            },
            message: {
              type: "string",
            },
          },
          required: ["error", "message"],
        },
        DateTime: {
          type: "string",
          format: "date-time",
        },
      },
      parameters: {},
    },
    paths: {
      "/users/{id}": {
        post: {
          summary: "Update a single user",
          parameters: [
            {
              in: "path",
              name: "id",
              schema: {
                type: "integer",
                minimum: 0,
              },
              required: true,
              description: "The user ID, must be a positive integer",
            },
            {
              in: "query",
              name: "dryRun",
              schema: {
                type: "boolean",
              },
              required: true,
            },
            {
              in: "header",
              name: "x-some-uuid",
              schema: {
                type: "string",
                format: "uuid",
              },
              required: true,
              description: "Some UUID",
            },
            {
              in: "header",
              name: "x-some-date",
              schema: {
                $ref: "#/components/schemas/DateTime",
              },
              required: true,
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/User",
                },
              },
            },
          },
          responses: {
            200: {
              description: "Object with user data.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/User",
                  },
                },
              },
              headers: {
                "X-RateLimit-Limit": {
                  schema: {
                    type: "integer",
                    minimum: 0,
                  },
                  description: "Request limit per hour.",
                },
                "X-RateLimit-Remaining": {
                  schema: {
                    type: "integer",
                    minimum: 0,
                  },
                  description: "The number of requests left for the time window.",
                },
                "X-RateLimit-Reset": {
                  schema: {
                    $ref: "#/components/schemas/DateTime",
                  },
                  description: "The UTC date/time at which the current rate limit window resets.",
                },
              },
            },
            201: {
              description: "Object with user data.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/User",
                  },
                },
              },
            },
            400: {
              description: "Access denied",
              content: {
                "text/plain": {
                  schema: {
                    type: "string",
                    enum: ["Access denied"],
                  },
                },
              },
            },
            404: {
              description: "The user is not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/NotFoundError",
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});
