import { ZodRouteConfig } from "../openapi_registry.ts";

export type ToStatusCode<T extends string | number> = T extends string
  ? T extends `${infer N extends number}` ? N : never
  : T extends number ? T
  : never;

export interface TypedResponse<S extends number, M extends string, D, H> {
  readonly status: S;
  readonly mediaType: M;
  readonly data: D;
  readonly headers: H;
}

export type Coalesce<T, D> = [T] extends [never] ? D : T;

export type OpenapiRouteConfig<P extends string = string> =
  & Pick<ZodRouteConfig, "method" | "summary" | "tags" | "description" | "request">
  & {
    path: P;
    responses?: ZodRouteConfig["responses"] | undefined;
  };

export type ExtractEndpointPaths<M extends ZodRouteConfig["method"], E> = M extends keyof E ? E[M] : never;

export type ExcludeUndefinedValue<O> = {
  [K in keyof O as (O[K] extends undefined ? never : K)]: O[K];
};

export type StripEmptyObjectType<T> = keyof T extends never ? Record<never, never> : T;

// deno-lint-ignore ban-types
export type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

export type GenericHeaders = HeadersInit;

export type MaybeRecord = Record<string, unknown> | undefined;

type ExtractUndefinedKeys<T> = {
  [K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

type MakeKeysOptional<T, K extends keyof T> =
  & Omit<T, K>
  & {
    [P in K]?: T[P];
  };

export type MakeUndefinedKeysOptional<T> = MakeKeysOptional<T, ExtractUndefinedKeys<T>>;
