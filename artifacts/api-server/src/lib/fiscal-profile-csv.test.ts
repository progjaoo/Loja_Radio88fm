import assert from "node:assert/strict";
import test from "node:test";
import { fiscalCsvCell, parseFiscalCsv } from "./fiscal-profile-csv.ts";

test("CSV parser handles quoted separators, escaped quotes, newlines, BOM, and blank rows", () => {
  const rows = parseFiscalCsv('\uFEFFid;name;note\r\n1;"Loja; Rádio";"diz ""olá"""\r\n\r\n2;"Produto\nEspecial";ok\r\n');
  assert.deepEqual(rows, [
    ["id", "name", "note"],
    ["1", "Loja; Rádio", 'diz "olá"'],
    [""],
    ["2", "Produto\nEspecial", "ok"],
  ]);
});

test("CSV parser rejects unclosed quoted cells", () => {
  assert.throws(() => parseFiscalCsv('id;name\n1;"produto'), /aspas não fechadas/);
});

test("export quotes spreadsheet formulas to reduce CSV injection risk", () => {
  assert.equal(fiscalCsvCell("=1+1"), "\"'=1+1\"");
  assert.equal(fiscalCsvCell("Produto Rádio"), "\"Produto Rádio\"");
});
