// sap.ui.define([
//     "sap/ui/core/mvc/Controller"
// ], (Controller) => {
//     "use strict";

//     return Controller.extend("com.bgl.app.cashreceipt.controller.CashReceipt", {
//         onInit() {
//         }
//     });
// });

sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/comp/smartvariants/PersonalizableInfo",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (
    Controller, JSONModel, Filter, FilterOperator,
    PersonalizableInfo, MessageBox, MessageToast
) {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════════════
    //  AMOUNT → WORDS  (Indian system: Lakh / Crore)
    // ═══════════════════════════════════════════════════════════════════════════
    var _ones = [
        "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN",
        "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN",
        "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"
    ];
    var _tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY",
                 "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

    function _numToWords(n) {
        if (n === 0)  { return ""; }
        if (n < 20)   { return _ones[n]; }
        if (n < 100)  {
            return _tens[Math.floor(n / 10)] +
                   (n % 10 ? " " + _ones[n % 10] : "");
        }
        if (n < 1000) {
            return _ones[Math.floor(n / 100)] + " HUNDRED" +
                   (n % 100 ? " " + _numToWords(n % 100) : "");
        }
        if (n < 100000) {
            return _numToWords(Math.floor(n / 1000)) + " THOUSAND" +
                   (n % 1000 ? " " + _numToWords(n % 1000) : "");
        }
        if (n < 10000000) {
            return _numToWords(Math.floor(n / 100000)) + " LAKH" +
                   (n % 100000 ? " " + _numToWords(n % 100000) : "");
        }
        return _numToWords(Math.floor(n / 10000000)) + " CRORE" +
               (n % 10000000 ? " " + _numToWords(n % 10000000) : "");
    }

    function _amountToWords(fAmount) {
        if (fAmount === null || fAmount === undefined || fAmount === "") { return ""; }
        var parts   = parseFloat(fAmount).toFixed(2).split(".");
        var rupees  = parseInt(parts[0], 10);
        var paise   = parseInt(parts[1], 10);
        var sWords  = rupees > 0 ? _numToWords(rupees) + " RUPEES" : "ZERO RUPEES";
        if (paise > 0) {
            sWords += " AND " + _numToWords(paise) + " PAISE";
        }
        return sWords + " ONLY";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONTROLLER
    // ═══════════════════════════════════════════════════════════════════════════
    return Controller.extend("com.bgl.app.cashreceipt.controller.CashReceipt", {

        // ───────────────────────────────────────────────────────────────────────
        //  onInit
        // ───────────────────────────────────────────────────────────────────────
        onInit: function () {
            this._pdfBlobUrl = null;

            // ── Busy dialog ────────────────────────────────────────────────────
            this._busyDialog = new sap.m.Dialog({
                showHeader: false,
                type: "Message",
                content: new sap.m.VBox({
                    justifyContent: "Center",
                    alignItems: "Center",
                    items: [
                        new sap.m.BusyIndicator({ size: "2rem" }),
                        new sap.m.Text({
                            text: "Generating Cash Receipt, please wait...",
                            textAlign: "Center"
                        }).addStyleClass("sapUiSmallMarginTop")
                    ]
                }),
                contentWidth: "280px",
                contentHeight: "120px",
                verticalScrolling: false,
                horizontalScrolling: false
            });

            // ── SmartVariantManagement + FilterBar wiring ──────────────────────
            this.oSmartVariantManagement = this.getView().byId("svm");
            this.oExpandedLabel          = this.getView().byId("expandedLabel");
            this.oSnappedLabel           = this.getView().byId("snappedLabel");
            this.oFilterBar              = this.getView().byId("filterbar");

            this.oFilterBar.registerFetchData(this.fetchData.bind(this));
            this.oFilterBar.registerApplyData(this.applyData.bind(this));
            this.oFilterBar.registerGetFiltersWithValues(
                this.getFiltersWithValues.bind(this)
            );

            var oPersInfo = new PersonalizableInfo({
                type:       "filterBar",
                keyName:    "persistencyKey",
                dataSource: "",
                control:    this.oFilterBar
            });
            this.oSmartVariantManagement.addPersonalizableControl(oPersInfo);
            this.oSmartVariantManagement.initialise(function () {}, this.oFilterBar);

            // ── PDF placeholder ────────────────────────────────────────────────
            this._setPdfPlaceholder();
        },

        // ───────────────────────────────────────────────────────────────────────
        //  onExit
        // ───────────────────────────────────────────────────────────────────────
        onExit: function () {
            this.oSmartVariantManagement = null;
            this.oExpandedLabel          = null;
            this.oSnappedLabel           = null;
            this.oFilterBar              = null;
            if (this._pdfBlobUrl) {
                URL.revokeObjectURL(this._pdfBlobUrl);
                this._pdfBlobUrl = null;
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  SmartVariantManagement stubs (required by FilterBar registration)
        // ═══════════════════════════════════════════════════════════════════════
        fetchData: function () {
            // Return current filter values for variant save
            return {
                documentNo:  this.byId("idDocumentNoInput").getValue(),
                fiscalYear:  this.byId("idPostingDateRange").getValue()
            };
        },

        applyData: function (oData) {
            // Restore filter values when a variant is loaded
            if (!oData) { return; }
            if (oData.documentNo !== undefined) {
                this.byId("idDocumentNoInput").setValue(oData.documentNo);
            }
            if (oData.fiscalYear !== undefined) {
                this.byId("idPostingDateRange").setValue(oData.fiscalYear);
            }
        },

        getFiltersWithValues: function () {
            // Tell the FilterBar which items currently have values
            // so it can show the "X filters active" label
            var aActiveFilters = [];
            var sDocNo = this.byId("idDocumentNoInput").getValue();
            var sFY    = this.byId("idPostingDateRange").getValue();
            if (sDocNo) { aActiveFilters.push(this.oFilterBar.getFilterGroupItems()[1]); }
            if (sFY)    { aActiveFilters.push(this.oFilterBar.getFilterGroupItems()[2]); }
            return aActiveFilters;
        },

        onFilterChange: function () {
            // Update snapped / expanded label text
            var aFilters = this.getFiltersWithValues();
            var sText    = aFilters.length > 0
                ? aFilters.length + " filter(s) active"
                : "No filters active";
            this.oExpandedLabel.setText(sText);
            this.oSnappedLabel.setText(sText);
        },

        onAfterVariantLoad: function () {
            this.onFilterChange();
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  INPUT FIELD HANDLERS
        // ═══════════════════════════════════════════════════════════════════════

        /** Called on every keystroke in Document No field */
        onDocumentNoClear: function (oEvent) {
            var sValue    = oEvent.getParameter("value");
            var oInput    = this.byId("idDocumentNoInput");

            // Live-clear error state as user types
            if (sValue) {
                oInput.setValueState(sap.ui.core.ValueState.None);
                oInput.setValueStateText("");
            }

            // If field is fully cleared, reset the PDF preview
            if (!sValue) {
                this._setPdfPlaceholder();
                if (this._pdfBlobUrl) {
                    URL.revokeObjectURL(this._pdfBlobUrl);
                    this._pdfBlobUrl = null;
                }
            }
        },

        /** Called when Fiscal Year DateRangeSelection changes */
        onPostingDateChange: function (oEvent) {
            var oCtrl = this.byId("idPostingDateRange");
            if (oEvent.getParameter("valid") || oCtrl.getValue()) {
                oCtrl.setValueState(sap.ui.core.ValueState.None);
                oCtrl.setValueStateText("");
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  VALIDATION
        // ═══════════════════════════════════════════════════════════════════════
        _validateInputs: function () {
            var oDocInput  = this.byId("idDocumentNoInput");
            var oDateRange = this.byId("idPostingDateRange");
            var bValid     = true;
            var aMessages  = [];

            // ── Document No ────────────────────────────────────────────────────
            var sDocNo = oDocInput.getValue().trim();
            if (!sDocNo) {
                oDocInput.setValueState(sap.ui.core.ValueState.Error);
                oDocInput.setValueStateText("Document No is required.");
                aMessages.push("Document No");
                bValid = false;
            } else {
                oDocInput.setValueState(sap.ui.core.ValueState.None);
                oDocInput.setValueStateText("");
            }

            // ── Fiscal Year ────────────────────────────────────────────────────
            var sFY = oDateRange.getValue().trim();
            if (!sFY) {
                oDateRange.setValueState(sap.ui.core.ValueState.Error);
                oDateRange.setValueStateText("Fiscal Year is required.");
                aMessages.push("Fiscal Year");
                bValid = false;
            } else {
                oDateRange.setValueState(sap.ui.core.ValueState.None);
                oDateRange.setValueStateText("");
            }

            if (!bValid) {
                MessageBox.error(
                    "Please fill the following required field(s): " +
                    aMessages.join(", ")
                );
            }
            return bValid;
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  onSearch  (FilterBar search event / Go button)
        // ═══════════════════════════════════════════════════════════════════════
        onSearch: function () {
            if (!this._validateInputs()) { return; }
            this._fetchReceiptData();
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  OData FETCH
        //  ► Adjust entity set names to match your ZSB_PAYMENT_RECEIPT service
        //
        //  Expected entities:
        //    ZC_PAYMENT_RECEIPT_HDR  – header (one row per document)
        //    ZC_PAYMENT_RECEIPT_LN   – line items / transactions
        //
        //  Expected filter keys:  CompanyCode | DocumentNo | FiscalYear
        // ═══════════════════════════════════════════════════════════════════════
        _fetchReceiptData: function () {
            var that          = this;
            var oServiceModel = this.getOwnerComponent().getModel();

            var sCompanyCode = this.byId("idComCode").getValue()         || "1000";
            var sDocNo       = this.byId("idDocumentNoInput").getValue().trim();
            var oDateCtrl    = this.byId("idPostingDateRange");
            var sDateValue   = oDateCtrl.getValue();          // e.g. "2024 – 2025"
            var sDelimiter   = " – ";

            // Parse fiscal year range from DateRangeSelection
            var sFYFrom = "";
            var sFYTo   = "";
            if (sDateValue && sDateValue.indexOf(sDelimiter) > -1) {
                var aParts = sDateValue.split(sDelimiter);
                sFYFrom    = aParts[0].trim();
                sFYTo      = aParts[1].trim();
            } else if (sDateValue) {
                sFYFrom = sFYTo = sDateValue.trim();
            }

            // ── Build OData filters ────────────────────────────────────────────
            var aFilters = [];

            if (sCompanyCode) {
                aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCompanyCode));
            }
            if (sDocNo) {
                aFilters.push(new Filter("DocumentNo", FilterOperator.EQ, sDocNo));
            }
            if (sFYFrom) {
                aFilters.push(new Filter("FiscalYear", FilterOperator.GE, sFYFrom));
            }
            if (sFYTo) {
                aFilters.push(new Filter("FiscalYear", FilterOperator.LE, sFYTo));
            }

            sap.ui.core.BusyIndicator.show(0);

            // ── Read Header ────────────────────────────────────────────────────
            var pHeader = new Promise(function (resolve, reject) {
                oServiceModel.read("/ZC_PAYMENT_RECEIPT_HDR", {
                    filters: aFilters,
                    success: function (oData) {
                        console.log("Receipt Header:", oData.results);
                        resolve(oData.results || []);
                    },
                    error: function (oErr) { reject(oErr); }
                });
            });

            // ── Read Line Items ────────────────────────────────────────────────
            var pLines = new Promise(function (resolve, reject) {
                oServiceModel.read("/ZC_PAYMENT_RECEIPT_LN", {
                    filters: aFilters,
                    success: function (oData) {
                        console.log("Receipt Lines:", oData.results);
                        resolve(oData.results || []);
                    },
                    error: function (oErr) { reject(oErr); }
                });
            });

            // ── Promise.all ────────────────────────────────────────────────────
            Promise.all([pHeader, pLines])
                .then(function (aResults) {
                    sap.ui.core.BusyIndicator.hide();

                    var aHdr = aResults[0];
                    var aLn  = aResults[1];

                    if (!aHdr.length && !aLn.length) {
                        MessageBox.warning(
                            "No receipt data found for Document No: " +
                            sDocNo + " / Fiscal Year: " + (sFYFrom || "-")
                        );
                        return;
                    }

                    that._loadPdfMakeLibrary(aHdr, aLn);
                })
                .catch(function (oErr) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error("OData fetch error:", oErr);
                    try {
                        var oErrObj = JSON.parse(oErr.responseText);
                        MessageBox.error(oErrObj.error.message.value);
                    } catch (e) {
                        MessageBox.error(
                            "Failed to fetch receipt data. Please check Document No and Fiscal Year."
                        );
                    }
                });
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  LOAD pdfMake LIBRARIES  (sequential, same pattern as BarCodeView)
        // ═══════════════════════════════════════════════════════════════════════
        _loadPdfMakeLibrary: function (aHdrData, aLnData) {
            var that   = this;
            var sBase  = jQuery.sap.getModulePath("com.bgl.app.cashreceipt");

            sap.ui.core.BusyIndicator.show(0);

            jQuery.sap.includeScript(
                sBase + "/libs/pdfmake/pdfmake.min.js",
                "pdfMakeScript",
                function () {
                    jQuery.sap.includeScript(
                        sBase + "/libs/pdfmake/vfs_fonts.js",
                        "vfsFontsScript",
                        function () {
                            sap.ui.core.BusyIndicator.hide();

                            if (typeof pdfMake === "undefined") {
                                MessageBox.error("pdfMake library not loaded. Check /libs/pdfmake/.");
                                return;
                            }

                            // Convert BGL logo to base64 then generate PDF
                            that._convertImgToBase64(
                                sBase + "/model/BGL_logo.png",
                                function (sBase64Logo) {
                                    that._generateCashReceiptPdf(aHdrData, aLnData, sBase64Logo);
                                }
                            );
                        },
                        function () {
                            sap.ui.core.BusyIndicator.hide();
                            MessageBox.error("Failed to load vfs_fonts.js");
                        }
                    );
                },
                function () {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error("Failed to load pdfmake.min.js");
                }
            );
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  IMAGE → BASE64  (same helper as BarCodeView)
        // ═══════════════════════════════════════════════════════════════════════
        _convertImgToBase64: function (sUrl, fnCallback) {
            var oImg = new Image();
            oImg.crossOrigin = "Anonymous";
            oImg.onload = function () {
                var oCanvas    = document.createElement("canvas");
                oCanvas.width  = oImg.width;
                oCanvas.height = oImg.height;
                oCanvas.getContext("2d").drawImage(oImg, 0, 0);
                fnCallback(oCanvas.toDataURL("image/png"));
            };
            oImg.onerror = function () {
                console.warn("BGL logo not found at: " + sUrl + " — generating PDF without logo.");
                fnCallback(null);
            };
            oImg.src = sUrl;
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  DATE FORMATTER  →  DD/MM/YYYY
        // ═══════════════════════════════════════════════════════════════════════
        _formatDate: function (vDate) {
            if (!vDate) { return ""; }
            var oDate = (vDate instanceof Date) ? vDate : new Date(vDate);
            if (isNaN(oDate.getTime())) { return String(vDate); }
            return String(oDate.getDate()).padStart(2, "0") + "/" +
                   String(oDate.getMonth() + 1).padStart(2, "0") + "/" +
                   oDate.getFullYear();
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  GENERATE BGL CASH RECEIPT PDF
        //
        //  Layout  (mirrors BGL_Cash_Receipt_Format.pdf):
        //
        //  ┌───────────────────────────────────────────────────────────┐
        //  │ [Logo]   Bhagyanagar Gas Limited                          │
        //  │          (A Joint venture of GAIL & HPCL)                 │
        //  ├───────────────────────────────────────────────────────────┤
        //  │                   CASH RECEIPT                            │
        //  ├──────────────┬──────────┬────────────┬──────────┬────────┤
        //  │ Received From│ BP CODE  │  Issuing   │RECEIPT NO│  DATE  │
        //  │              │          │  Location  │          │        │
        //  ├──────────────┼──────────┼────────────┼──────────┼────────┤
        //  │ [CustName]   │ [BPCode] │ [IssuLoc]  │[ReceiptNo│[Date]  │
        //  ├──────────────┴──────────┴────────────┴──────────┴────────┤
        //  │ Transaction/CHQ NO │ Reference │    DATE    │  ₹AMOUNT   │
        //  ├────────────────────┼───────────┼────────────┼────────────┤
        //  │ [ChqNo]            │  [Ref]    │  [ValDt]   │   [Amt]    │
        //  ├───────────────────────────────────────────────────────────┤
        //  │                  RUPEES (IN WORDS)                        │
        //  │  [Amount in words]                                        │
        //  ├───────────────────────────────────────────────────────────┤
        //  │                     REMARKS                               │
        //  │  [Payment Reference / remarks]                            │
        //  └───────────────────────────────────────────────────────────┘
        //  * This is a system generated receipt no signature is required
        // ═══════════════════════════════════════════════════════════════════════
        _generateCashReceiptPdf: function (aHdrData, aLnData, sBase64Logo) {
            var that = this;

            this._busyDialog.open();

            try {
                // ── Shared layout helpers ──────────────────────────────────────
                var fLine = function () { return 1; };
                var sBlack = "#000000";

                function cell(sText, oOpts) {
                    oOpts = oOpts || {};
                    return {
                        text:       sText !== null && sText !== undefined ? String(sText) : "",
                        fontSize:   oOpts.fontSize   || 9,
                        bold:       oOpts.bold        || false,
                        alignment:  oOpts.alignment   || "left",
                        fillColor:  oOpts.fillColor   || null,
                        color:      oOpts.color       || sBlack,
                        colSpan:    oOpts.colSpan     || 1,
                        border:     oOpts.border      || [true, true, true, true],
                        margin:     oOpts.margin      || [4, 4, 4, 4],
                        italics:    oOpts.italics     || false
                    };
                }

                var aContent = [];

                // ── Render one PDF block per header record ─────────────────────
                aHdrData.forEach(function (oHdr, iIdx) {

                    // ── Data from OData header ─────────────────────────────────
                    // ⚙️  Adjust field names to match your CDS/OData entity fields
                    var sReceiptNo   = oHdr.ReceiptNo        || oHdr.DocumentNo       || "";
                    var sPostingDate = that._formatDate(oHdr.PostingDate);
                    var sCustName    = oHdr.CustomerName     || oHdr.ReceivedFrom      || "";
                    var sBPCode      = oHdr.BPCode           || oHdr.BusinessPartner   || "";
                    var sIssuingLoc  = oHdr.IssuingLocation  || oHdr.CompanyCode       || "";
                    var sRemarks     = oHdr.Remarks          || oHdr.PaymentReference  || "";

                    // Find matching line items for this receipt
                    var aLines = aLnData.filter(function (oLn) {
                        return oLn.ReceiptNo    === sReceiptNo  ||
                               oLn.DocumentNo   === oHdr.DocumentNo;
                    });

                    // Page break between receipts
                    if (iIdx > 0) {
                        aContent.push({ text: "", pageBreak: "before" });
                    }

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 1 : COMPANY HEADER  (Logo + Name)
                    // ──────────────────────────────────────────────────────────
                    var aLogoNameRow;
                    if (sBase64Logo) {
                        aLogoNameRow = [
                            {
                                image:     sBase64Logo,
                                width:     55,
                                height:    55,
                                alignment: "center",
                                margin:    [6, 4, 6, 4],
                                border:    [true, true, false, true]
                            },
                            {
                                stack: [
                                    {
                                        text:      "Bhagyanagar Gas Limited",
                                        bold:      true,
                                        fontSize:  18,
                                        alignment: "center",
                                        color:     "#1a3c6e",
                                        margin:    [0, 8, 0, 2]
                                    },
                                    {
                                        text:      "(A Joint venture of GAIL & HPCL)",
                                        fontSize:  9,
                                        alignment: "center",
                                        color:     "#444444",
                                        margin:    [0, 0, 0, 6]
                                    }
                                ],
                                border: [false, true, true, true],
                                margin: [0, 0, 0, 0]
                            }
                        ];
                    } else {
                        // No logo – use text initials box instead
                        aLogoNameRow = [
                            {
                                stack: [
                                    { text: "BGL", bold: true, fontSize: 20,
                                      alignment: "center", color: "#1a3c6e",
                                      margin: [0, 8, 0, 2] },
                                    { text: "(A Joint venture of GAIL & HPCL)",
                                      fontSize: 9, alignment: "center", color: "#444444",
                                      margin: [0, 0, 0, 6] }
                                ],
                                colSpan: 2,
                                border: [true, true, true, true],
                                margin: [0, 0, 0, 0]
                            },
                            {}
                        ];
                    }

                    aContent.push({
                        table: {
                            widths: [65, "*"],
                            body:   [aLogoNameRow]
                        },
                        layout: {
                            hLineWidth: fLine, vLineWidth: fLine,
                            hLineColor: function () { return sBlack; },
                            vLineColor: function () { return sBlack; }
                        },
                        margin: [0, 0, 0, 0]
                    });

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 2 : "CASH RECEIPT" TITLE
                    // ──────────────────────────────────────────────────────────
                    aContent.push({
                        table: {
                            widths: ["*"],
                            body: [[{
                                text:      "CASH RECEIPT",
                                fontSize:  13,
                                bold:      true,
                                alignment: "center",
                                margin:    [0, 6, 0, 6],
                                border:    [true, false, true, true]
                            }]]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 3 : RECEIVED FROM / BP CODE / ISSUING LOC / RECEIPT NO / DATE
                    //   Col widths: 28% | 16% | 18% | 20% | 18%
                    // ──────────────────────────────────────────────────────────
                    aContent.push({
                        table: {
                            widths: ["28%", "16%", "18%", "20%", "18%"],
                            body: [
                                // Header row
                                [
                                    cell("Received From",     { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("BP CODE",           { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("Issuing\nLocation", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("RECEIPT\nNO",       { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("DATE",              { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" })
                                ],
                                // Data row
                                [
                                    cell(sCustName,    { fontSize: 9, alignment: "center" }),
                                    cell(sBPCode,      { fontSize: 9, alignment: "center" }),
                                    cell(sIssuingLoc,  { fontSize: 9, alignment: "center" }),
                                    cell(sReceiptNo,   { fontSize: 9, alignment: "center", bold: true }),
                                    cell(sPostingDate, { fontSize: 9, alignment: "center" })
                                ]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 4 : TRANSACTION / CHQ NO | REFERENCE | DATE | ₹AMOUNT
                    //   Col widths: 28% | 28% | 22% | 22%
                    // ──────────────────────────────────────────────────────────
                    var aLnRows = [
                        // Header row
                        [
                            cell("Transaction/\nCHQ NO", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                            cell("Reference",             { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                            cell("DATE",                  { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                            cell("₹ AMOUNT",              { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" })
                        ]
                    ];

                    if (aLines.length > 0) {
                        aLines.forEach(function (oLn) {
                            var fAmt    = parseFloat(oLn.Amount || 0);
                            var sAmt    = fAmt.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            });
                            aLnRows.push([
                                cell(oLn.ChqNo      || oLn.TransactionNo  || "", { fontSize: 9, alignment: "center" }),
                                cell(oLn.Reference  || oLn.PaymentRef     || "", { fontSize: 9, alignment: "center" }),
                                cell(that._formatDate(oLn.ValueDate || oLn.PostingDate),   { fontSize: 9, alignment: "center" }),
                                cell(sAmt,                                                  { fontSize: 9, alignment: "right", bold: true })
                            ]);
                        });
                    } else {
                        // Single empty row as placeholder
                        aLnRows.push([
                            cell("", { fontSize: 9 }),
                            cell("", { fontSize: 9 }),
                            cell("", { fontSize: 9 }),
                            cell("", { fontSize: 9 })
                        ]);
                    }

                    aContent.push({
                        table: {
                            widths: ["28%", "28%", "22%", "22%"],
                            body:    aLnRows
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 5 : RUPEES IN WORDS
                    // ──────────────────────────────────────────────────────────
                    // Sum all line amounts
                    var fTotal = 0;
                    if (aLines.length > 0) {
                        fTotal = aLines.reduce(function (sum, oLn) {
                            return sum + parseFloat(oLn.Amount || 0);
                        }, 0);
                    } else {
                        fTotal = parseFloat(oHdr.Amount || oHdr.TotalAmount || 0);
                    }
                    var sAmountWords = _amountToWords(fTotal);

                    aContent.push({
                        table: {
                            widths: ["*"],
                            body: [
                                [{
                                    text:       "RUPEES\n(IN WORDS)",
                                    bold:       true,
                                    fontSize:   8,
                                    alignment:  "center",
                                    fillColor:  "#f0f0f0",
                                    margin:     [0, 4, 0, 2],
                                    border:     [true, false, true, false]
                                }],
                                [{
                                    text:      sAmountWords,
                                    fontSize:  9,
                                    alignment: "center",
                                    margin:    [4, 4, 4, 4],
                                    border:    [true, false, true, true]
                                }]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 6 : REMARKS
                    // ──────────────────────────────────────────────────────────
                    aContent.push({
                        table: {
                            widths: ["*"],
                            body: [
                                [{
                                    text:      "REMARKS",
                                    bold:      true,
                                    fontSize:  8,
                                    alignment: "center",
                                    fillColor: "#f0f0f0",
                                    margin:    [0, 4, 0, 2],
                                    border:    [true, false, true, false]
                                }],
                                [{
                                    text:    sRemarks || " ",
                                    fontSize: 9,
                                    margin:  [4, 6, 4, 24], // extra bottom for manual remarks space
                                    border:  [true, false, true, true]
                                }]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ──────────────────────────────────────────────────────────
                    // BLOCK 7 : FOOTER NOTE
                    // ──────────────────────────────────────────────────────────
                    aContent.push({
                        text:    "* This is a system generated receipt no signature is required",
                        fontSize: 8,
                        italics: true,
                        color:   "#555555",
                        margin:  [2, 8, 0, 0]
                    });

                }); // end forEach header

                // ── Document definition ────────────────────────────────────────
                var oDocDef = {
                    pageSize:    "A4",
                    pageMargins: [30, 30, 30, 30],
                    content:     aContent,
                    defaultStyle: {
                        fontSize: 9
                    }
                };

                // ── Render into iframe ─────────────────────────────────────────
                pdfMake.createPdf(oDocDef).getBlob(function (oBlob) {
                    // Revoke old Blob URL to free memory
                    if (that._pdfBlobUrl) {
                        URL.revokeObjectURL(that._pdfBlobUrl);
                    }

                    var sBlobUrl = URL.createObjectURL(oBlob);
                    that._pdfBlobUrl = sBlobUrl;

                    // Inject iframe into the core:HTML container
                    var oHtml = that.byId("pdfIframeContainer");
                    oHtml.setContent(
                        '<div style="width:100%; height:calc(100vh - 100px);">' +
                            '<iframe src="' + sBlobUrl + '" ' +
                                'style="width:100%; height:100%; border:none;" ' +
                                'frameborder="0">' +
                            '</iframe>' +
                        '</div>'
                    );

                    that._busyDialog.close();
                });

            } catch (oErr) {
                console.error("PDF generation failed:", oErr);
                this._busyDialog.close();
                MessageBox.error("Failed to generate Cash Receipt PDF.\n" + oErr.message);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  PDF PLACEHOLDER  (shown before first search)
        // ═══════════════════════════════════════════════════════════════════════
        _setPdfPlaceholder: function () {
            var oHtml = this.byId("pdfIframeContainer");
            if (!oHtml) { return; }
            oHtml.setContent(
                '<div style="' +
                    'height:calc(100vh - 255px);' +
                    'display:flex;' +
                    'align-items:center;' +
                    'justify-content:center;' +
                    'flex-direction:column;' +
                    'color:#888;' +
                    'font-family:Arial,sans-serif;' +
                    'text-align:center;' +
                    'border:2px dashed #ccc;' +
                    'border-radius:8px;' +
                    'background:#fafafa;">' +
                    '<div style="font-size:3rem;margin-bottom:12px;">🧾</div>' +
                    '<h3 style="margin:0 0 8px 0;color:#555;">No Receipt Generated</h3>' +
                    '<p style="margin:0;color:#999;">' +
                        'Enter <b>Document No</b> and <b>Fiscal Year</b>, then click <b>Go</b>.' +
                    '</p>' +
                '</div>'
            );
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  FLOATING BUTTON HANDLERS
        // ═══════════════════════════════════════════════════════════════════════

        /** Open PDF in a new browser tab for printing */
        onDownloadPdf: function () {
            if (!this._pdfBlobUrl) {
                MessageToast.show("No PDF generated yet. Please click Go first.");
                return;
            }
            var oWin = window.open("", "_blank");
            if (!oWin) {
                MessageToast.show("Please allow pop-ups to open the PDF.");
                return;
            }
            oWin.document.write(
                "<html><head><title>BGL Cash Receipt</title>" +
                "<style>html,body{margin:0;height:100%;overflow:hidden;}" +
                "iframe{width:100%;height:100%;border:none;}</style></head>" +
                "<body><iframe src=\"" + this._pdfBlobUrl + "\" allow=\"fullscreen\"></iframe>" +
                "</body></html>"
            );
            oWin.document.close();
        },

        /** Close / reset PDF preview and clear all inputs */
        onClosePdfPreview: function () {
            // Reset input fields + value states
            var oDocInput  = this.byId("idDocumentNoInput");
            var oDateRange = this.byId("idPostingDateRange");

            oDocInput.setValue("").setValueState(sap.ui.core.ValueState.None);
            oDateRange.setValue("").setValueState(sap.ui.core.ValueState.None);

            // Restore placeholder
            this._setPdfPlaceholder();

            // Release Blob URL
            if (this._pdfBlobUrl) {
                URL.revokeObjectURL(this._pdfBlobUrl);
                this._pdfBlobUrl = null;
            }
        }

    }); // end Controller.extend

}); // end sap.ui.define