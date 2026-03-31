import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { verifyFirebaseIdToken } from "@/lib/auth/firebase";
import { DUMMY_PASSWORD } from "@/lib/constants";
import { createGuestUser, getUser, upsertUserFromFirebase } from "@/lib/db/queries";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "firebase",
      credentials: {},
      async authorize({ idToken }: any) {
        if (typeof idToken !== "string" || idToken.length === 0) {
          console.error("[auth] Invalid idToken provided");
          return null;
        }

        try {
          const verifiedUser = await verifyFirebaseIdToken(idToken);
          const dbUser = await upsertUserFromFirebase({
            firebaseUid: verifiedUser.localId,
            email: verifiedUser.email,
          });

          if (!dbUser?.id) {
            console.error("[auth] upsertUserFromFirebase returned user without id:", { dbUser });
            return null;
          }

          return { ...dbUser, type: "regular" };
        } catch (error) {
          console.error("[auth] Firebase authorization failed:", error instanceof Error ? error.message : String(error));
          return null;
        }
      },
    }),
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) {
          return null;
        }

        return { ...user, type: "regular" };
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: "guest" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        if (!user.id) {
          console.error("[auth] User object missing id field:", { user });
          throw new Error("User ID is required but missing");
        }
        token.id = user.id;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (!token.id) {
          console.error("[auth] Token missing id field:", { token });
          throw new Error("Token ID is required but missing");
        }
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
