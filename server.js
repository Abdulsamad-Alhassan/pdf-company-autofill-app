  const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const XLSX = require("xlsx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const app = express();
const PORT = 3000;

const uploadsDir = path.join(__dirname, "uploads");
const generatedDir = path.join(__dirname, "generated");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, safeName);
  },
});

const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/generated", express.static(generatedDir));

const jobs = new Map();

function sanitizeForFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function looksLikeMostlyEnglishText(values) {
  const nonEmpty = values.filter((v) => v.length > 0);
  if (nonEmpty.length === 0) {
    return false;
  }

  const textLike = nonEmpty.filter((v) => /[A-Za-z]/.test(v)).length;
  return textLike / nonEmpty.length >= 0.6;
}

function looksLikeMostlyArabicText(values) {
  const nonEmpty = values.filter((v) => v.length > 0);
  if (nonEmpty.length === 0) {
    return false;
  }

  const textLike = nonEmpty.filter((v) => /[\u0600-\u06FF]/.test(v)).length;
  return textLike / nonEmpty.length >= 0.6;
}

function detectColumn(rows, headerKeywords, isTextMatch) {
  const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => normalizeCellValue(cell).length > 0));
  if (nonEmptyRows.length === 0) {
    return { index: -1, hasHeader: false };
  }

  const maxColumns = nonEmptyRows.reduce((max, row) => Math.max(max, row.length), 0);
  if (maxColumns === 0) {
    return { index: -1, hasHeader: false };
  }

  const firstRow = nonEmptyRows[0] || [];
  for (let col = 0; col < maxColumns; col += 1) {
    const headerValue = normalizeCellValue(firstRow[col]).toLowerCase();
    if (headerKeywords.some((keyword) => headerValue.includes(keyword))) {
      return { index: col, hasHeader: true };
    }
  }

  let bestColumn = -1;
  let bestScore = -1;
  for (let col = 0; col < maxColumns; col += 1) {
    const colValues = nonEmptyRows.map((row) => normalizeCellValue(row[col]));
    const filledCount = colValues.filter((v) => v.length > 0).length;
    if (filledCount === 0) {
      continue;
    }

    const score = isTextMatch(colValues) ? filledCount + 1000 : filledCount;
    if (score > bestScore) {
      bestScore = score;
      bestColumn = col;
    }
  }

  return { index: bestColumn, hasHeader: false };
}

function parseCompaniesFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
  const englishKeywords = ["company", "company name", "organization", "organisation", "vendor", "client", "english"];
  const arabicKeywords = ["اسم الشركة", "الشركة", "اسم الجهة", "اسم المنشأة", "arabic"];

  const englishColumn = detectColumn(rows, englishKeywords, looksLikeMostlyEnglishText);
  const arabicColumn = detectColumn(rows, arabicKeywords, looksLikeMostlyArabicText);
  const hasHeader = englishColumn.hasHeader || arabicColumn.hasHeader;

  if (englishColumn.index < 0 && arabicColumn.index < 0) {
    return [];
  }

  const rowValues = rows
    .map((row) => {
      const en = englishColumn.index >= 0 && Array.isArray(row) ? normalizeCellValue(row[englishColumn.index]) : "";
      const ar = arabicColumn.index >= 0 && Array.isArray(row) ? normalizeCellValue(row[arabicColumn.index]) : "";
      const companyNameEn = en || ar;
      const companyNameAr = ar || en;

      return {
        companyNameEn,
        companyNameAr,
      };
    })
    .filter((row) => row.companyNameEn.length > 0 || row.companyNameAr.length > 0);

  return hasHeader ? rowValues.slice(1) : rowValues;
}

async function buildPdfForCompany({
  templateBuffer,
  companyNameEn,
  companyNameAr,
  userName,
  userId,
  companyEnX,
  companyEnY,
  companyArX,
  companyArY,
  nameX,
  nameY,
  idX,
  idY,
  pageNumber,
  fontSize,
}) {
  const pdfDoc = await PDFDocument.load(templateBuffer);
  const pages = pdfDoc.getPages();
  const targetPageIndex = Math.min(Math.max(pageNumber - 1, 0), pages.length - 1);
  const page = pages[targetPageIndex];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const drawText = (text, x, y, align = "left") => {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      return;
    }

    const textWidth = font.widthOfTextAtSize(normalizedText, fontSize);
    const drawX = align === "right" ? x - textWidth : x;

    page.drawText(normalizedText, {
      x: drawX,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  };

  drawText(companyNameEn, companyEnX, companyEnY);
  drawText(companyNameAr, companyArX, companyArY, "right");
  drawText(userName, nameX, nameY);
  drawText(userId, idX, idY);

  return pdfDoc.save();
}

app.post(
  "/api/process",
  upload.fields([
    { name: "excelFile", maxCount: 1 },
    { name: "pdfTemplate", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const excelFile = req.files?.excelFile?.[0];
      const pdfTemplate = req.files?.pdfTemplate?.[0];

      if (!excelFile || !pdfTemplate) {
        return res.status(400).json({ error: "Excel file and PDF template are required." });
      }

      const userName = String(req.body.userName || "").trim();
      const userId = String(req.body.userId || "").trim();

      if (!userName || !userId) {
        return res.status(400).json({ error: "User name and ID are required." });
      }

      const legacyCompanyX = parseNumber(req.body.companyX, 100);
      const legacyCompanyY = parseNumber(req.body.companyY, 500);
      const companyEnX = parseNumber(req.body.companyEnX, legacyCompanyX);
      const companyEnY = parseNumber(req.body.companyEnY, legacyCompanyY);
      const companyArX = parseNumber(req.body.companyArX, companyEnX);
      const companyArY = parseNumber(req.body.companyArY, companyEnY);
      const nameX = parseNumber(req.body.nameX, 100);
      const nameY = parseNumber(req.body.nameY, 470);
      const idX = parseNumber(req.body.idX, 100);
      const idY = parseNumber(req.body.idY, 440);
      const fontSize = parseNumber(req.body.fontSize, 12);
      const pageNumber = parseNumber(req.body.pageNumber, 1);

      const companies = parseCompaniesFromExcel(excelFile.path);
      if (companies.length === 0) {
        return res.status(400).json({ error: "No company names found in the Excel file (English or Arabic columns)." });
      }

      const templateBuffer = fs.readFileSync(pdfTemplate.path);
      const jobId = crypto.randomUUID();
      const jobOutputDir = path.join(generatedDir, jobId);
      fs.mkdirSync(jobOutputDir, { recursive: true });

      const files = [];
      for (const company of companies) {
        const bytes = await buildPdfForCompany({
          templateBuffer,
          companyNameEn: company.companyNameEn,
          companyNameAr: company.companyNameAr,
          userName,
          userId,
          companyEnX,
          companyEnY,
          companyArX,
          companyArY,
          nameX,
          nameY,
          idX,
          idY,
          pageNumber,
          fontSize,
        });

        const safeCompany = sanitizeForFileName(company.companyNameEn || company.companyNameAr);
        const safeUser = sanitizeForFileName(userName);
        const safeId = sanitizeForFileName(userId);
        const fileName = `${safeCompany}_${safeUser}_${safeId}.pdf`;
        const fullPath = path.join(jobOutputDir, fileName);

        fs.writeFileSync(fullPath, bytes);
        files.push({
          companyName: company.companyNameEn || company.companyNameAr,
          fileName,
          downloadUrl: `/api/download/${jobId}/${encodeURIComponent(fileName)}`,
        });
      }

      jobs.set(jobId, {
        createdAt: Date.now(),
        files,
      });

      return res.json({
        jobId,
        total: files.length,
        companies: files.map((f) => ({ companyName: f.companyName, downloadUrl: f.downloadUrl })),
      });
    } catch (error) {
      return res.status(500).json({ error: `Processing failed: ${error.message}` });
    }
  }
);

app.get("/api/download/:jobId/:fileName", (req, res) => {
  const { jobId, fileName } = req.params;
  const decodedName = decodeURIComponent(fileName);
  const requestedPath = path.join(generatedDir, jobId, decodedName);

  if (!fs.existsSync(requestedPath)) {
    return res.status(404).json({ error: "File not found." });
  }

  return res.download(requestedPath);
});

app.listen(PORT, () => {
  console.log(`App running at http://localhost:${PORT}`);
});
