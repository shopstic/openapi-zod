import { OpenapiEndpoints, OpenapiEndpointTypeBag, transformRecordToStringValues } from "./openapi_endpoint.ts";
import { OpenapiGenerator } from "./generator/openapi_generator.ts";
import { OpenapiRegistry, ZodRouteConfig } from "./openapi_registry.ts";
import {
  extractRequestBodySchema,
  extractRequestHeadersSchema,
  extractRequestParamsSchema,
  extractRequestQuerySchema,
} from "./runtime/request.ts";
import { ExtractEndpointPaths, MaybeRecord, OpenapiRouteConfig, Simplify, TypedResponse } from "./types/shared.ts";
import { z, ZodError, ZodType } from "./zod.ts";

export interface OpenapiServerRequestContext<P, Q, H, B> {
  url: URL;
  params: P;
  query: Q;
  headers: H;
  body: B;
  request: Request;
  connInfo: Deno.ServeHandlerInfo;
}

export class RawResponse extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
  }

  toResponse() {
    return this;
  }
}

type OpenapiRequestValidationErrorSource = "params" | "query" | "headers" | "body";

type RequestContextType<Bag> = Bag extends
  OpenapiEndpointTypeBag<infer P, infer Q, infer H, infer B, unknown, unknown, unknown>
  ? OpenapiServerRequestContext<P, Q, H, B>
  : OpenapiServerRequestContext<unknown, unknown, unknown, unknown>;

type MaybePromise<T> = Promise<T> | T;

type RequestHanderResponseType<Bag> = Bag extends
  OpenapiEndpointTypeBag<MaybeRecord, MaybeRecord, MaybeRecord, unknown, infer R, unknown, unknown> ? R
  : ServerResponse<number, string, unknown, unknown>;

type ResponseBodyByStatusAndMediaMap<Bag> = Bag extends
  OpenapiEndpointTypeBag<MaybeRecord, MaybeRecord, MaybeRecord, unknown, unknown, infer B, unknown> ? B : never;

type ResponseHeadersByStatusMap<Bag> = Bag extends
  OpenapiEndpointTypeBag<MaybeRecord, MaybeRecord, MaybeRecord, unknown, unknown, unknown, infer H> ? H : never;

type ResponseHeadersByStatus<M, S> = S extends keyof M ? (
    M[S] extends never ? unknown : Simplify<M[S]> & Record<string, unknown>
  )
  : unknown;

type ServerResponder<S extends number, M extends string, B, H> = unknown extends H
  ? (unknown extends B ? (body?: B, headers?: HeadersInit) => ServerResponse<S, M, B, HeadersInit>
    : (body: B, headers?: HeadersInit) => ServerResponse<S, M, B, HeadersInit>)
  : (
    (body: B, headers: H) => ServerResponse<S, M, B, H>
  );

type ServerResponderFactory<Bag> = <
  BM extends ResponseBodyByStatusAndMediaMap<Bag>,
  S extends Extract<keyof BM, number>,
  M extends Extract<keyof BM[S], string>,
  B extends BM[S][M],
  H extends ResponseHeadersByStatus<ResponseHeadersByStatusMap<Bag>, S>,
>(
  status: S,
  mediaType: M,
) => ServerResponder<S, M, B, H>;

const genericResponderFactory = (status: number, mediaType: string) => (body: unknown, headers: unknown) =>
  new ServerResponse(status, mediaType, body, headers);

type QuerySchema = {
  key: string;
  schema: ZodType;
  isArray: boolean;
};

type OpenapiRoute<Bag> = {
  path: string;
  urlPattern?: URLPattern;
  paramSchemas?: [string, ZodType][];
  querySchemas?: QuerySchema[];
  headerSchemas?: [string, ZodType][];
  bodySchema?: ZodType;
  validationErrorHandler?: (source: OpenapiRequestValidationErrorSource, error: ZodError<unknown>) => Response;
  handler: (
    request: RequestContextType<Bag>,
    respond: ServerResponderFactory<Bag>,
  ) => MaybePromise<RequestHanderResponseType<Bag>>;
};

type EraseRoute<R, M extends ZodRouteConfig["method"], P extends string> = {
  [K in keyof R]: K extends M ? Omit<R[K], P>
    : R[K];
};

export function memoizePromise<T>(create: () => Promise<T>): typeof create {
  let memoized: Promise<T> | null = null;

  return () => {
    if (!memoized) {
      memoized = create();
    }
    return memoized;
  };
}

export class OpenapiRouter<R> {
  private endpoints: OpenapiEndpoints<R>;
  private defaultValidationErrorHandler = (source: OpenapiRequestValidationErrorSource, error: ZodError<unknown>) => {
    return new Response(
      JSON.stringify(
        {
          message: "Request validation failed",
          source,
          errors: error.errors,
        },
        null,
        2,
      ),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };
  private registry: OpenapiRegistry;
  private routesByUppercasedMethodMap: Map<string, {
    byPathTemplateMap: Map<string, OpenapiRoute<unknown>>;
    byPathMap: Map<string, OpenapiRoute<unknown>>;
    patternList: OpenapiRoute<unknown>[];
  }>;

  constructor({ endpoints, registry, defaultValidationErrorHandler, openapiSpecPath = "/docs/openapi" }: {
    endpoints: OpenapiEndpoints<R>;
    registry: OpenapiRegistry;
    openapiSpecPath?: string;
    defaultValidationErrorHandler?: (source: OpenapiRequestValidationErrorSource, error: ZodError<unknown>) => Response;
  }) {
    this.registry = registry;
    this.endpoints = endpoints;
    this.routesByUppercasedMethodMap = new Map();

    const memorizedDocs = memoizePromise(() => {
      const generator = new OpenapiGenerator(registry.definitions);
      const document = generator.generateDocument({
        openapi: "3.0.0",
        info: {
          title: "Test",
          version: "1.0.0",
        },
      });

      return Promise.resolve(
        new ServerResponse(200, "application/json", document, null),
      );
    });

    this.addRoute({
      method: "get",
      path: openapiSpecPath,
      responses: {
        200: {
          description: "OpenAPI v3 specification",
          content: {
            "application/json": {
              schema: z.unknown(),
            },
          },
        },
      },
    }, {
      path: openapiSpecPath,
      urlPattern: new URLPattern({ pathname: openapiSpecPath.replaceAll(/{([^}]+)}/g, ":$1") }),
      validationErrorHandler: defaultValidationErrorHandler,
      handler() {
        return memorizedDocs();
      },
    });

    if (defaultValidationErrorHandler) {
      this.defaultValidationErrorHandler = defaultValidationErrorHandler;
    }
  }

  get<
    E extends ExtractEndpointPaths<"get", R>,
    P extends Extract<keyof E, string>,
  >(
    path: P,
    handler: OpenapiRoute<E[P]>["handler"],
    validationErrorHandler?: OpenapiRoute<E[P]>["validationErrorHandler"],
  ): OpenapiRouter<EraseRoute<R, "get", P>> {
    return this.method("get", path, handler, validationErrorHandler);
  }

  put<
    E extends ExtractEndpointPaths<"put", R>,
    P extends Extract<keyof E, string>,
  >(
    path: P,
    handler: OpenapiRoute<E[P]>["handler"],
    validationErrorHandler?: OpenapiRoute<E[P]>["validationErrorHandler"],
  ) {
    return this.method("put", path, handler, validationErrorHandler);
  }

  post<
    E extends ExtractEndpointPaths<"post", R>,
    P extends Extract<keyof E, string>,
  >(
    path: P,
    handler: OpenapiRoute<E[P]>["handler"],
    validationErrorHandler?: OpenapiRoute<E[P]>["validationErrorHandler"],
  ) {
    return this.method("post", path, handler, validationErrorHandler);
  }

  patch<
    E extends ExtractEndpointPaths<"patch", R>,
    P extends Extract<keyof E, string>,
  >(
    path: P,
    handler: OpenapiRoute<E[P]>["handler"],
    validationErrorHandler?: OpenapiRoute<E[P]>["validationErrorHandler"],
  ) {
    return this.method("patch", path, handler, validationErrorHandler);
  }

  delete<
    E extends ExtractEndpointPaths<"delete", R>,
    P extends Extract<keyof E, string>,
  >(
    path: P,
    handler: OpenapiRoute<E[P]>["handler"],
    validationErrorHandler?: OpenapiRoute<E[P]>["validationErrorHandler"],
  ) {
    return this.method("delete", path, handler, validationErrorHandler);
  }

  private method<
    M extends ZodRouteConfig["method"],
    P extends string,
    C,
  >(
    method: M,
    path: P,
    handler: OpenapiRoute<C>["handler"],
    validationErrorHandler?: OpenapiRoute<C>["validationErrorHandler"],
  ): OpenapiRouter<EraseRoute<R, M, P>> {
    const upperCasedMethod = method.toUpperCase();

    if (
      this.routesByUppercasedMethodMap.has(upperCasedMethod) &&
      this.routesByUppercasedMethodMap.get(upperCasedMethod)!.byPathTemplateMap.has(path)
    ) {
      throw new Error(`Duplicate route for the combination of method=${method} path=${path}`);
    }

    const endpoint = this.endpoints.get(path, method);

    if (!endpoint) {
      throw new Error(`Defect: endpoint not found path=${path} method=${method}`);
    }

    const config = endpoint.config;
    const patternPath = path.replaceAll(/{([^}]+)}/g, ":$1");

    const route: OpenapiRoute<unknown> = {
      path,
      urlPattern: path !== patternPath ? new URLPattern({ pathname: patternPath }) : undefined,
      querySchemas: extractRequestQuerySchema(config),
      paramSchemas: extractRequestParamsSchema(config),
      headerSchemas: extractRequestHeadersSchema(config),
      bodySchema: extractRequestBodySchema(config),
      validationErrorHandler,
      // deno-lint-ignore no-explicit-any
      handler: handler as any,
    };

    return this.addRoute(config, route);
  }

  private notFound() {
    return new Response("Not found", {
      status: 404,
    });
  }

  private addRoute(config: OpenapiRouteConfig<string>, route: OpenapiRoute<unknown>) {
    const { method, path } = config;

    const upperCasedMethod = method.toUpperCase();

    if (!this.routesByUppercasedMethodMap.has(upperCasedMethod)) {
      this.routesByUppercasedMethodMap.set(upperCasedMethod, {
        byPathMap: new Map(),
        byPathTemplateMap: new Map(),
        patternList: [],
      });
    }

    const routes = this.routesByUppercasedMethodMap.get(upperCasedMethod)!;

    routes.byPathTemplateMap.set(path, route);

    if (route.urlPattern !== undefined) {
      routes.patternList.push(route);
    } else {
      routes.byPathMap.set(route.path, route);
    }

    this.registry.registerPath({
      ...config,
      responses: config.responses ?? {
        200: {
          description: "OK",
        },
      },
    });

    return this;
  }

  async handle(request: Request, connInfo: Deno.ServeHandlerInfo): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const routes = this.routesByUppercasedMethodMap.get(request.method);

    if (!routes) {
      return this.notFound();
    }

    let matchedRoute: OpenapiRoute<unknown> | undefined;
    let params: Record<string, string | undefined> | undefined;

    matchedRoute = routes.byPathMap.get(pathname);

    if (!matchedRoute) {
      matchedRoute = routes.patternList.find((r) => r.urlPattern!.test(url));
      if (matchedRoute) {
        params = matchedRoute.urlPattern!.exec(url)!.pathname.groups;
      }
    }

    if (!matchedRoute) {
      return this.notFound();
    }

    const { paramSchemas, querySchemas, headerSchemas, bodySchema } = matchedRoute;

    const validationErrorHandler = matchedRoute.validationErrorHandler ?? this.defaultValidationErrorHandler;

    const searchParams = url.searchParams;
    const headers = Object.fromEntries(request.headers.entries());
    const body = bodySchema !== undefined ? await request.json() : request.body;

    const validatedParams: [string, unknown][] = [];
    const validatedQuery: [string, unknown][] = [];
    const validatedHeaders: [string, unknown][] = [];
    let validatedBody: unknown = body;

    if (paramSchemas) {
      const validatingParams = params ?? {};

      for (const [key, schema] of paramSchemas) {
        const paramValidation = schema.safeParse(validatingParams[key]);

        if (paramValidation.success) {
          validatedParams.push([key, paramValidation.data]);
        } else {
          return validationErrorHandler("params", paramValidation.error);
        }
      }
    }

    if (querySchemas) {
      for (const { key, schema, isArray } of querySchemas) {
        const rawValue = isArray ? searchParams.getAll(key) : searchParams.get(key);
        const queryValidation = schema.safeParse(rawValue);

        if (queryValidation.success) {
          validatedQuery.push([key, queryValidation.data]);
        } else {
          return validationErrorHandler("query", queryValidation.error);
        }
      }
    }

    if (headerSchemas) {
      const validatingHeaders = headers ?? {};

      for (const [key, schema] of headerSchemas) {
        const headerValidation = schema.safeParse(validatingHeaders[key]);

        if (headerValidation.success) {
          validatedHeaders.push([key, headerValidation.data]);
        } else {
          return validationErrorHandler("headers", headerValidation.error);
        }
      }
    }

    if (bodySchema) {
      const bodyValidation = bodySchema.safeParse(body);

      if (bodyValidation.success) {
        validatedBody = bodyValidation.data;
      } else {
        return validationErrorHandler("body", bodyValidation.error);
      }
    }

    const ctx: OpenapiServerRequestContext<unknown, unknown, unknown, unknown> = {
      url,
      params: Object.fromEntries(validatedParams),
      query: Object.fromEntries(validatedQuery),
      headers: Object.fromEntries(validatedHeaders),
      body: validatedBody,
      request,
      connInfo,
    };

    const maybePromise = matchedRoute.handler(ctx, genericResponderFactory as ServerResponderFactory<unknown>);
    const typedResponse = (maybePromise instanceof Promise) ? await maybePromise : maybePromise;
    return typedResponse.toResponse();
  }
}

export class ServerResponse<S extends number, M extends string, D, H> implements TypedResponse<S, M, D, H> {
  constructor(readonly status: S, readonly mediaType: M, readonly data: D, readonly headers: H) {
  }

  toResponse(): Response {
    let body: BodyInit;

    if (this.mediaType === "application/json") {
      body = JSON.stringify(this.data, null, 2);
    } else {
      // deno-lint-ignore no-explicit-any
      body = this.data as any;
    }

    const headersInit = this.headers ?? undefined as HeadersInit | undefined;
    const headers = new Headers(
      (typeof headersInit === "object" && headersInit !== null && !Array.isArray(headersInit))
        ? transformRecordToStringValues(headersInit as Record<string, unknown>)
        : headersInit,
    );

    if (!headers.get("content-type")) {
      headers.set("content-type", this.mediaType);
    }

    return new Response(body, {
      status: this.status,
      headers,
    });
  }
}
