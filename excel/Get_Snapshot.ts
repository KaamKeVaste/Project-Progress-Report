function main(workbook: ExcelScript.Workbook): string {
    const ds = workbook.getWorksheet("Dashboard");
    const status = String(ds.getRange("M8").getValue());
    if (status !== "Publish requested") return "";
    const sheet = workbook.getWorksheet("_publish");
    if (!sheet) return "";
    return String(sheet.getRange("A1").getValue());
}
