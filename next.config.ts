import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next logs every Server Function call with its arguments in dev — which
  // leaks secrets passed to actions like setKeyAction into the terminal.
  logging: {
    serverFunctions: false,
  },
  devIndicators: {
    position: "bottom-right",
  },
  // The create-project server action reads lib/prompt/defaults/ from disk to
  // seed a new repo. fs auto-tracing is unreliable, so include those files
  // explicitly in that route's bundle. (The agent route needs nothing here —
  // its guidance is code, and repo files come over the GitHub API.)
  outputFileTracingIncludes: {
    "/settings": ["./lib/prompt/defaults/**"],
  },
};

export default nextConfig;
