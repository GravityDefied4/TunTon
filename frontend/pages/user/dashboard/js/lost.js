/* File a lost report page.
   ?claim=<found report id> needs that report, which comes from the database, so wait for it first
   (a failed load still opens the form; the claim banner just does not appear). */
reportsReady.catch(() => {}).then(() => initReportForm('lost'));