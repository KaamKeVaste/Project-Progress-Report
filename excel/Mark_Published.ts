function main(workbook: ExcelScript.Workbook, who: string, ok: boolean) {
    const ds = workbook.getWorksheet("Dashboard");
    ds.getRange("M7").setValue(who);
    ds.getRange("M8").setValue(ok ? "Published" : "FAILED - not published");
}
