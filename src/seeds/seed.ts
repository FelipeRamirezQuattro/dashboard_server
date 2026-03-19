import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.model";
import ExternalApp from "../models/App.model";
import { env } from "../config/env";
import logger from "../utils/logger";

dotenv.config();

const seedData = async (): Promise<void> => {
  try {
    // Connect to MongoDB
    await mongoose.connect(env.mongodbUri);
    logger.info("Connected to MongoDB");

    // Clear existing data
    await User.deleteMany({});
    await ExternalApp.deleteMany({});
    logger.info("Cleared existing data");

    // Create superadmin user
    const adminUser = await User.create({
      firstName: "Admin",
      lastName: "User",
      email: "admin@osi.com",
      passwordHash: "Admin123!", // This will be hashed by the pre-save hook
      role: "superadmin",
      isActive: true,
    });

    logger.info(`Created superadmin user: ${adminUser.email}`);

    // Create sample external apps
    const sampleApps = [
      // Real Applications
      {
        name: "Designer",
        description:
          "OSI Designer is a comprehensive oil & gas sales and engineering platform. Features include well design & simulation with 3D wellbore visualization, proposal management, product configuration, tally & pulling design tools, engineering calculations, sales tracking, chemical tracking, and a client portal.",
        url: "https://designer.osi-apps.com",
        iconUrl: "https://via.placeholder.com/64/3B82F6/FFFFFF?text=DES",
        category: "other",
        requiredRole: "viewer",
        isActive: true,
        comingSoon: false,
        createdBy: adminUser._id,
      },
      {
        name: "Chemical Tracker",
        description:
          "A web application for Odessa Separator Inc. to manage oil and gas wells, clients, and chemical analysis reports. Features include client & well management, chemical level tracking (Fe, Mn, THPS, Polytag, inhibitors), production data metrics, an interactive analytics dashboard with cross-module navigation, and Excel import/export.",
        url: "https://chemical-tracker.osi-apps.com",
        chatbotApiUrl: "https://api.osidesigner.com/api-chemtracker",
        iconUrl: "https://via.placeholder.com/64/10B981/FFFFFF?text=CHEM",
        category: "chemical",
        requiredRole: "viewer",
        isActive: true,
        comingSoon: false,
        createdBy: adminUser._id,
      },
      {
        name: "Pump Tracker (OSI Pump Pro)",
        description:
          "A comprehensive pump management system for oil and gas operations. Features include multi-role user management, client organization management, pulling reports with component tracking (barrel, plunger, valves, accessories), automated PDF generation, data visualization (sand sieve, radar & solids charts), AWS S3 file management, and full Swagger/OpenAPI docs at /api.",
        url: "https://pump-tracker.osi-apps.com",
        iconUrl: "https://via.placeholder.com/64/F59E0B/FFFFFF?text=PUMP",
        category: "pumps",
        requiredRole: "viewer",
        isActive: true,
        comingSoon: false,
        createdBy: adminUser._id,
      },
      // Placeholder Apps (Coming Soon)
      {
        name: "Gas Separator Control System",
        description:
          "Monitor and control gas separation units in real-time. View performance metrics, adjust parameters, and receive alerts.",
        url: "https://gas.osi-apps.com",
        ssoEndpoint: "api://gas-separator-app/.default",
        iconUrl: "https://via.placeholder.com/64/3B82F6/FFFFFF?text=GAS",
        category: "gas",
        requiredRole: "viewer",
        isActive: true,
        comingSoon: true,
        createdBy: adminUser._id,
      },
      {
        name: "Sand Control Analytics",
        description:
          "Advanced analytics and reporting for sand and filtration control systems. Track performance trends and optimize operations.",
        url: "https://sand.osi-apps.com",
        ssoEndpoint: "api://sand-control-app/.default",
        iconUrl: "https://via.placeholder.com/64/6366F1/FFFFFF?text=SAND",
        category: "sand",
        requiredRole: "editor",
        isActive: true,
        comingSoon: true,
        createdBy: adminUser._id,
      },
      {
        name: "Field Operations Portal",
        description:
          "Comprehensive field operations management including well data, production reports, and equipment tracking.",
        url: "https://operations.osi-apps.com",
        iconUrl: "https://via.placeholder.com/64/8B5CF6/FFFFFF?text=OPS",
        category: "other",
        requiredRole: "viewer",
        isActive: true,
        comingSoon: true,
        createdBy: adminUser._id,
      },
      {
        name: "Safety & Compliance Center",
        description:
          "Environmental and safety compliance tracking, incident reporting, and regulatory documentation management.",
        url: "https://safety.osi-apps.com",
        iconUrl: "https://via.placeholder.com/64/EF4444/FFFFFF?text=SAFE",
        category: "admin",
        requiredRole: "admin",
        isActive: true,
        comingSoon: true,
        createdBy: adminUser._id,
      },
    ];

    const apps = await ExternalApp.insertMany(sampleApps);
    logger.info(`Created ${apps.length} sample applications`);

    // Create additional test users
    const testUsers = [
      {
        firstName: "John",
        lastName: "Viewer",
        email: "viewer@osi.com",
        passwordHash: "Viewer123!",
        role: "viewer",
        isActive: true,
      },
      {
        firstName: "Jane",
        lastName: "Editor",
        email: "editor@osi.com",
        passwordHash: "Editor123!",
        role: "editor",
        isActive: true,
      },
      {
        firstName: "Bob",
        lastName: "Manager",
        email: "manager@osi.com",
        passwordHash: "Manager123!",
        role: "admin",
        isActive: true,
      },
    ];

    const users = await User.insertMany(testUsers);
    logger.info(`Created ${users.length} test users`);

    logger.info("\n✅ Database seeded successfully!");
    logger.info("\n📝 Login Credentials:");
    logger.info("   Superadmin: admin@osi.com / Admin123!");
    logger.info("   Admin: manager@osi.com / Manager123!");
    logger.info("   Editor: editor@osi.com / Editor123!");
    logger.info("   Viewer: viewer@osi.com / Viewer123!");
    logger.info("\n🎯 Sample Apps Created:");
    apps.forEach((app) => {
      logger.info(`   - ${app.name} (${app.category})`);
    });

    process.exit(0);
  } catch (error) {
    logger.error("Error seeding database:", error);
    process.exit(1);
  }
};

seedData();
