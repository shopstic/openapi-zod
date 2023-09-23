import { OpenapiRouteConfig } from "../types/shared.ts";
import { ZodType } from "../zod.ts";

export type ResponseSchemaMap = Map<
  number,
  Map<string, {
    body?: ZodType;
    headers?: [string, ZodType][];
  }>
>;

export function extractResponseSchemaMap<C extends OpenapiRouteConfig>(config: C): ResponseSchemaMap | undefined {
  if (config.responses) {
    const responses = Object.entries(config.responses).flatMap(([statusCode, response]) => {
      if (response.content) {
        let headerSchemaList: [string, ZodType][] | undefined = [];

        if (response.headers) {
          headerSchemaList = [];
          for (const [headerName, { schema: headerSchema }] of Object.entries(response.headers)) {
            if (headerSchema instanceof ZodType) {
              headerSchemaList.push([headerName, headerSchema]);
            }
          }
        }

        return Object.entries(response.content).map(([mediaType, media]) => {
          return {
            statusCode: parseInt(statusCode),
            mediaType,
            bodySchema: media.schema instanceof ZodType ? media.schema : undefined,
            headerSchemaList,
          };
        });
      }

      return [];
    });

    return responses.reduce(
      (map, { statusCode, mediaType, bodySchema, headerSchemaList }) => {
        if (!map.has(statusCode)) {
          map.set(statusCode, new Map());
        }

        map.get(statusCode)!.set(mediaType, {
          body: bodySchema,
          headers: headerSchemaList,
        });
        return map;
      },
      new Map() as ResponseSchemaMap,
    );
  }
}
