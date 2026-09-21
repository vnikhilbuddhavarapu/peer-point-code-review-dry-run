import { createServer } from "node:http";

import { orderTotal } from "./order.js";

const port = Number(process.env.PORT ?? 8080);
createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `<!doctype html><html><body><h1>Order Service</h1><p>Sample total: $${orderTotal([{ price: 10, quantity: 2 }], 0.1)}</p></body></html>`,
  );
}).listen(port, "0.0.0.0");
