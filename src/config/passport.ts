import passport from "passport";
import { OIDCStrategy, IProfile, VerifyCallback } from "passport-azure-ad";
import { env } from "./env";
import User from "../models/User.model";
import logger from "../utils/logger";

// Determine user role based on email
const determineUserRole = (email: string): "admin" | "editor" | "viewer" => {
  const normalizedEmail = email.toLowerCase().trim();

  if (env.ssoAdminEmails.includes(normalizedEmail)) {
    return "admin";
  }

  if (env.ssoEditorEmails.includes(normalizedEmail)) {
    return "editor";
  }

  return "viewer";
};

export const configurePassport = (): void => {
  const azureAdConfig = {
    identityMetadata: `https://login.microsoftonline.com/${env.azureTenantId}/v2.0/.well-known/openid-configuration`,
    clientID: env.azureClientId,
    clientSecret: env.azureClientSecret,
    responseType: "code" as const,
    responseMode: "query" as const,
    redirectUrl: env.azureRedirectUri,
    allowHttpForRedirectUrl: env.nodeEnv === "development",
    validateIssuer: true,
    passReqToCallback: false as const,
    scope: ["profile", "email", "openid"],
    loggingLevel: (env.nodeEnv === "development" ? "info" : "error") as
      | "info"
      | "error",
    nonceLifetime: 3600,
    nonceMaxAmount: 5,
    useCookieInsteadOfSession: false,
  };

  passport.use(
    new OIDCStrategy(
      azureAdConfig,
      async (profile: IProfile, done: VerifyCallback): Promise<void> => {
        try {
          if (!profile.oid || !profile._json?.email) {
            return done(
              new Error("Invalid profile data from Azure AD"),
              undefined,
            );
          }

          const email = profile._json.email as string;
          const microsoftId = profile.oid;
          const firstName = (profile.name?.givenName ||
            profile._json?.given_name ||
            "User") as string;
          const lastName = (profile.name?.familyName ||
            profile._json?.family_name ||
            "") as string;

          // Determine role based on email
          const userRole = determineUserRole(email);

          // Find or create user
          let user = await User.findOne({ microsoftId });

          if (!user) {
            // Check if user exists with this email (local account)
            user = await User.findOne({ email });
            if (user) {
              // Link Microsoft account to existing user
              user.microsoftId = microsoftId;
              user.firstName = firstName;
              user.lastName = lastName;
              // Update role based on current configuration
              user.role = userRole;
              await user.save();
              logger.info(
                `Linked Microsoft account for ${email} with role: ${userRole}`,
              );
            } else {
              // Create new user with determined role
              user = await User.create({
                email,
                microsoftId,
                firstName,
                lastName,
                role: userRole,
                isActive: true,
              });
              logger.info(
                `Created new SSO user ${email} with role: ${userRole}`,
              );
            }
          } else {
            // Update role on each login (allows dynamic role changes via env)
            const previousRole = user.role;
            user.role = userRole;
            user.lastLogin = new Date();
            await user.save();

            if (previousRole !== userRole) {
              logger.info(
                `Updated role for ${email}: ${previousRole} → ${userRole}`,
              );
            }
          }

          logger.info(`User authenticated via SSO: ${email}`);
          return done(null, user);
        } catch (error) {
          logger.error("Error in Azure AD authentication:", error);
          return done(error as Error, undefined);
        }
      },
    ),
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as any)._id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
};

export default configurePassport;
