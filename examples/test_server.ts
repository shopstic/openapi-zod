import { OpenapiRouter } from "../src/openapi_server.ts";
import { z } from "../src/zod.ts";
import { endpoints, registry, UserSchema } from "./test_endpoints.ts";

const router = new OpenapiRouter({ registry, endpoints })
  .get("/healthz", ({ connInfo }, respond) => {
    console.log("connInfo", connInfo);

    return respond(200, "text/plain")();
  })
  .get("/alivez", (_, respond) => {
    /* return new ServerResponse(200, "application/json", {
      isOk: true,
    }, {
      "X-RateLimit-Limit": 5000,
      "X-RateLimit-Remaining": 4999,
      "X-RateLimit-Reset": new Date(Date.now() + 3600000),
      "some-extra-stuff": "here",
    }); */
    return respond(200, "text/plain")("OK", {
      "X-RateLimit-Limit": 5000,
      "X-RateLimit-Remaining": 4999,
      "X-RateLimit-Reset": new Date(Date.now() + 3600000),
      "some-extra-stuff": "here",
    });
  })
  .get("/download/{fileName}.pdf", async ({ params }, respond) => {
    console.log("fileName", params.fileName);

    const file = await fetch("https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf");

    return respond(200, "application/pdf")(file.body, {
      "some-extra-stuff": "here",
    });
  })
  .get("/users/{id}", ({ params, connInfo }, respond) => {
    console.log("connInfo", connInfo);
    console.log("param: id", params.id);

    const responseBody: z.infer<typeof UserSchema> = {
      id: 123,
      age: 88,
      gender: "female",
      name: "test",
      weapon: {
        type: "b",
        b: "whatever",
      },
    };

    return respond(200, "application/json")(responseBody);
  })
  .put("/users/{id}", ({ params, query, headers, body, connInfo }, respond) => {
    console.log("remoteAddr", connInfo.remoteAddr);
    console.log("param: id", params.id);
    console.log("query: dryRun", query.dryRun);
    console.log("query: dates", query.dates);
    console.log("header: X-Some-UUID", headers["x-some-uuid"]);
    console.log("header: X-Some-Date", headers["x-some-date"].toLocaleString());
    console.log("body", body.id, body.age, body.name, body.gender);

    return respond(200, "application/json")(body, {
      "some-extra-stuff": "here",
    });
  })
  .post("/users/{id}", ({ params, query, headers, body, connInfo }, respond) => {
    console.log("remoteAddr", connInfo.remoteAddr);
    console.log("param: id", params.id);
    console.log("query: dryRun", query.dryRun);
    console.log("headers", headers);
    console.log("body", body.id, body.age, body.name, body.gender);

    if (params.id > 500) {
      return respond(404, "application/json")({
        error: true,
        message: `The user with id ${params.id} is not found`,
      }, {});
    }

    return respond(200, "application/json")(body, {
      "some-extra-stuff": "here",
    });
  });

await Deno
  .serve({
    port: 9876,
    onListen({ hostname, port }) {
      console.log(`OpenAPI server is up at http://${hostname}:${port}`);
    },
  }, async (request, connInfo) => {
    console.log("<<<", request.method, request.url, request.headers);
    const response = await router.handle(request, connInfo);
    console.log(">>>", response);
    return response;
  })
  .finished;
