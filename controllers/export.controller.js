import { buildExcelExport, filenameDate, writePdfExport } from "../services/export.service.js";

function exportQuery(req) {
  return {
    from: req.query.from,
    to: req.query.to,
    accountId: req.query.accountId,
  };
}

async function exportPdfController(req, res, next) {
  try {
    const date = filenameDate(new Date());
    res.setHeader("Content-Disposition", `attachment; filename="JUVO_Trading_Report_${date}.pdf"`);
    await writePdfExport(req.user.id, exportQuery(req), res);
  } catch (error) {
    next(error);
  }
}

async function exportExcelController(req, res, next) {
  try {
    const buffer = await buildExcelExport(req.user.id, exportQuery(req));
    const date = filenameDate(new Date());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="JUVO_Trading_Data_${date}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(Buffer.from(buffer));
  } catch (error) {
    return next(error);
  }
}

export { exportPdfController, exportExcelController };
