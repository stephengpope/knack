"use client";

import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
// Type-only import: erased at build, so the server-only auth module (db, etc.)
// is never bundled into the client. Gives `timezone` et al. proper typing.
import type { auth } from "@/lib/auth";

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>(), adminClient()],
});

export const { signIn, signOut, useSession } = authClient;
