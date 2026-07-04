// Vercel serverless entry point for the provider proxy.
//
// Vercel serverless functions receive a different request/response shape than
// Node's raw http.createServer — the body is pre-buffered, request.url only
// contains the path portion, and headers are already lowercased. This adapter
// bridges that gap so routeProviderProxyRequest works unchanged.

import { routeProviderProxyRequest } from "../server/provider-proxy.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  // Vercel already parses JSON bodies, but routeProviderProxyRequest's readJson
  // expects an async-iterable stream. We create a minimal adapter that yields
  // the raw body buffer so the existing code works without changes.
  const adaptedRequest = Object.create(request, {
    // Ensure the URL is the full path (Vercel sometimes strips the origin)
    url: { value: request.url, writable: true, configurable: true },
  });

  // If Vercel has already parsed/buffered the body, make it iterable again
  // so readJson() can consume it via `for await (const chunk of request)`.
  if (request.body !== undefined && request.body !== null) {
    const bodyStr = typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);
    const bodyBuffer = Buffer.from(bodyStr, "utf8");

    adaptedRequest[Symbol.asyncIterator] = async function* () {
      yield bodyBuffer;
    };
  }

  return routeProviderProxyRequest(adaptedRequest, response, process.env);
}
