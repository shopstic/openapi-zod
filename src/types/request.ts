import { z, ZodType } from "../zod.ts";
import { MakeUndefinedKeysOptional, OpenapiRouteConfig } from "./shared.ts";

type FromZodRecord<T> = {
  [M in Extract<keyof T, string>]: T[M] extends ZodType ? z.infer<T[M]> : never;
};

export type ExtractRequestParamsType<C extends OpenapiRouteConfig> = C extends {
  request: {
    params: infer P;
  };
} ? MakeUndefinedKeysOptional<FromZodRecord<P>>
  : never;

export type ExtractRequestQueryType<C extends OpenapiRouteConfig> = C extends {
  request: {
    query: infer Q;
  };
} ? MakeUndefinedKeysOptional<FromZodRecord<Q>>
  : never;

export type ExtractRequestHeadersType<C extends OpenapiRouteConfig> = C extends {
  request: {
    headers: infer H;
  };
} ? MakeUndefinedKeysOptional<FromZodRecord<H>>
  : never;

export type ExtractRequestBodyType<C extends OpenapiRouteConfig> = C extends {
  request: {
    body: {
      content: {
        "application/json": {
          schema: infer B;
        };
      };
    };
  };
} ? B extends ZodType ? z.infer<B> : undefined
  : undefined;

// const config = {
//   method: "get" as const,
//   path: "/foo",
//   request: {
//     headers: {
//       "x-foo": z.string(),
//     },
//   },
// };

// type Debug = ExtractRequestHeadersType<typeof config>;
