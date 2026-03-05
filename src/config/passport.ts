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
    loggingLevel: "info" as "info" | "error",
    nonceLifetime: 3600,
    nonceMaxAmount: 5,
    useCookieInsteadOfSession: true, // Use cookies for state persistence
    cookieEncryptionKeys: [
      { 
        key: env.sessionSecret.substring(0, 32), // Must be exactly 32 bytes
        iv: env.sessionSecret.substring(0, 12)   // Must be exactly 12 bytes
      },
    ],
    cookieSameSite: env.nodeEnv === "production",
  };

  passport.use(
    new OIDCStrategy(
      azureAdConfig,
      async (profile: IProfile, done: VerifyCallback): Promise<void> => {
        try {
          logger.info("Azure AD callback received");
          logger.info(
            `Profile OID: ${profile.oid}, Email: ${profile._json?.email}`,
          );

          if (!profile.oid || !profile._json?.email) {
            logger.error("Invalid profile data - missing OID or email");
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

          logger.info(
            `User authenticated via SSO: ${email} with role: ${userRole}`,
          );
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
