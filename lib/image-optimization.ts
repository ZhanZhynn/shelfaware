import type { NextConfig } from "next";

type ImagesConfig = NonNullable<NextConfig["images"]>;

/** Only the configured ImageKit account may use the server-side optimizer. */
export function buildImageOptimizationConfig(imagekitEndpoint?: string): ImagesConfig {
  const remotePatterns: NonNullable<ImagesConfig["remotePatterns"]> = [];

  if (imagekitEndpoint?.trim()) {
    let endpoint: URL;
    try {
      endpoint = new URL(imagekitEndpoint.trim());
    } catch {
      throw new Error("ImageKit URL endpoint must be an HTTPS account URL");
    }

    const pathname = endpoint.pathname.replace(/\/+$/, "");
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username || endpoint.password || endpoint.port ||
      endpoint.search || endpoint.hash ||
      !/^[a-z\d.-]+$/.test(endpoint.hostname) ||
      (pathname && !/^(\/[a-z\d_-]+)+$/i.test(pathname)) ||
      (endpoint.hostname === "ik.imagekit.io" && !pathname)
    ) {
      // Do not include the configured value: a malformed URL may contain credentials.
      throw new Error("ImageKit URL endpoint must be an HTTPS account URL without credentials, wildcards, query parameters or a custom port");
    }

    remotePatterns.push({
      protocol: "https",
      hostname: endpoint.hostname,
      port: "",
      pathname: `${pathname}/**`,
      search: "",
    });
  }

  return {
    remotePatterns,
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    // Redirect targets are not checked against remotePatterns by Next.js.
    maximumRedirects: 0,
    maximumResponseBody: 5 * 1024 * 1024,
    maximumDiskCacheSize: 256 * 1024 * 1024,
    dangerouslyAllowLocalIP: false,
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "script-src 'none'; frame-src 'none'; sandbox;",
  };
}
