import chai from "chai";
const expect = chai.expect;

export function checkOk(res, code, label = "") {
    const ctx = label ? `[${label}] ` : "";
    expect(res.status, `${ctx}unexpected status — body: ${JSON.stringify(res.body)}`).to.equal(code);
    expect(res.body, `${ctx}success response missing "data"`).to.have.property("data");
    return res.body.data.result;
}

export function checkError(res, code, nOfErrors, label = "") {
    const ctx = label ? `[${label}] ` : "";
    expect(res.status, `${ctx}unexpected status — body: ${JSON.stringify(res.body)}`).to.equal(code);
    expect(res.body.data, `${ctx}error response should not carry "data"`).to.be.undefined;
    if (nOfErrors) {
        expect(res.body.error.length, `${ctx}wrong number of errors`).to.equal(nOfErrors);
    }
}

export function multiErrorCheck(res, codes, label = "") {
    const ctx = label ? `[${label}] ` : "";
    expect(codes.includes(res.status),
        `${ctx}status ${res.status} not in ${JSON.stringify(codes)} — body: ${JSON.stringify(res.body)}`).to.equal(true);
    expect(res.body.data, `${ctx}error response should not carry "data"`).to.be.undefined;
    expect(res.body.error.length, `${ctx}expected at least one error`).to.be.above(0);
}
