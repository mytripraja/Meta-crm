import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/mappings - Get all field mappings
router.get("/", async (req, res) => {
  const mappings = await prisma.fieldMapping.findMany({
    orderBy: { createdAt: "asc" },
  });
  res.json(mappings);
});

// POST /api/mappings - Create mapping
router.post("/", async (req, res) => {
  const { metaFieldName, crmFieldName, isRequired, defaultValue } = req.body;
  if (!metaFieldName || !crmFieldName) {
    return res.status(400).json({ error: "Both field names are required" });
  }

  const mapping = await prisma.fieldMapping.create({
    data: {
      metaFieldName: metaFieldName.trim(),
      crmFieldName: crmFieldName.trim(),
      isRequired: isRequired || false,
      defaultValue: defaultValue || null,
    },
  });

  res.status(201).json(mapping);
});

// PUT /api/mappings/:id - Update mapping
router.put("/:id", async (req, res) => {
  const { metaFieldName, crmFieldName, isRequired, defaultValue } = req.body;

  const mapping = await prisma.fieldMapping.update({
    where: { id: req.params.id },
    data: {
      ...(metaFieldName !== undefined && { metaFieldName: metaFieldName.trim() }),
      ...(crmFieldName !== undefined && { crmFieldName: crmFieldName.trim() }),
      ...(isRequired !== undefined && { isRequired }),
      ...(defaultValue !== undefined && { defaultValue }),
    },
  });

  res.json(mapping);
});

// DELETE /api/mappings/:id - Delete mapping
router.delete("/:id", async (req, res) => {
  await prisma.fieldMapping.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// POST /api/mappings/test - Test a mapping with sample data
router.post("/test", async (req, res) => {
  const { sampleData } = req.body;
  const mappings = await prisma.fieldMapping.findMany();

  const result = {};
  for (const mapping of mappings) {
    const value = sampleData[mapping.metaFieldName] || mapping.defaultValue || "";
    result[mapping.crmFieldName] = value;
  }

  res.json({ mapped: result, unmapped: Object.keys(sampleData).filter((k) => !mappings.find((m) => m.metaFieldName === k)) });
});

export default router;
