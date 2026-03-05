import { connectDB } from "../config/db";
import BusinessUnit from "../models/BusinessUnit.model";
import Department from "../models/Department.model";
import User from "../models/User.model";
import ExternalApp from "../models/App.model";
import logger from "../utils/logger";

async function seedHierarchy() {
  try {
    await connectDB();

    logger.info("Starting hierarchical seed...");

    // Get the first admin/superadmin user to assign as creator
    const adminUser = await User.findOne({
      role: { $in: ["admin", "superadmin"] },
    });

    if (!adminUser) {
      logger.error("No admin user found. Please create an admin user first.");
      process.exit(1);
    }

    logger.info(`Using admin user: ${adminUser.email}`);

    // Clear existing data (optional - comment out if you want to keep existing data)
    await BusinessUnit.deleteMany({});
    await Department.deleteMany({});
    logger.info("Cleared existing business units and departments");

    // Create Business Units
    const businessUnits = [
      {
        name: "OSI Rod Pump Division",
        description: "Rod pump manufacturing and service division",
        isActive: true,
        createdBy: adminUser._id,
      },
      {
        name: "Odessa Separator Inc",
        description: "Separator systems and solutions division",
        isActive: true,
        createdBy: adminUser._id,
      },
      {
        name: "Petro",
        description: "Petroleum equipment and services division",
        isActive: true,
        createdBy: adminUser._id,
      },
    ];

    const createdBUs = await BusinessUnit.insertMany(businessUnits);
    logger.info(`Created ${createdBUs.length} business units`);

    // Create Departments for each Business Unit
    const departments = [];

    for (const bu of createdBUs) {
      const deptNames = [
        { name: "Sales", description: "Sales and customer relations" },
        { name: "Technical", description: "Technical support and engineering" },
        { name: "Manufacturing", description: "Production and assembly" },
        { name: "Operations", description: "Operational management" },
        { name: "Engineering", description: "Design and R&D" },
        { name: "Quality", description: "Quality assurance and control" },
        {
          name: "HSE",
          description: "Health, Safety, and Environment compliance",
        },
      ];

      for (const dept of deptNames) {
        departments.push({
          name: dept.name,
          description: dept.description,
          businessUnitId: bu._id,
          isActive: true,
          createdBy: adminUser._id,
        });
      }
    }

    const createdDepts = await Department.insertMany(departments);
    logger.info(`Created ${createdDepts.length} departments`);

    // Assign existing apps to business units and departments
    const apps = await ExternalApp.find({});
    logger.info(`Found ${apps.length} existing applications to update`);

    if (apps.length > 0 && createdBUs.length > 0 && createdDepts.length > 0) {
      // Simple assignment strategy: distribute apps across BUs and their departments
      for (let i = 0; i < apps.length; i++) {
        const app = apps[i];
        const buIndex = i % createdBUs.length;
        const bu = createdBUs[buIndex];

        // Get departments for this BU
        const buDepartments = createdDepts.filter(
          (dept) => dept.businessUnitId.toString() === bu._id.toString(),
        );

        if (buDepartments.length > 0) {
          const deptIndex = i % buDepartments.length;
          const dept = buDepartments[deptIndex];

          await ExternalApp.findByIdAndUpdate(app._id, {
            businessUnitId: bu._id,
            departmentId: dept._id,
          });

          logger.info(`Assigned "${app.name}" to ${bu.name} > ${dept.name}`);
        }
      }
    }

    // Summary
    logger.info("\n=== Seed Summary ===");
    logger.info(`Business Units created: ${createdBUs.length}`);
    logger.info(`Departments created: ${createdDepts.length}`);
    logger.info(`Applications updated: ${apps.length}`);
    logger.info("\nBusiness Unit Structure:");
    for (const bu of createdBUs) {
      logger.info(`\n📦 ${bu.name}`);
      const buDepts = createdDepts.filter(
        (dept) => dept.businessUnitId.toString() === bu._id.toString(),
      );
      for (const dept of buDepts) {
        const deptApps = await ExternalApp.find({ departmentId: dept._id });
        logger.info(`  📁 ${dept.name} (${deptApps.length} apps)`);
      }
    }

    logger.info("\n✅ Hierarchy seed completed successfully!");
    process.exit(0);
  } catch (error) {
    logger.error("Error seeding hierarchy:", error);
    process.exit(1);
  }
}

seedHierarchy();
