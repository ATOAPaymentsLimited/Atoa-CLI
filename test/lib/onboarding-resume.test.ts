import {describe, it, expect} from "vitest";
import {onboardingResumeState} from "../../src/lib/onboarding-resume";

describe("onboardingResumeState", () => {
  it("resumes at step 2 when business structure is missing", () => {
    expect(onboardingResumeState({status: "PENDING", businessInfo: {legalBusinessName: "Acme"}})).toEqual({
      kind: "resume",
      step: 2
    });
  });

  it("resumes at step 3 when address is missing (the crash scenario)", () => {
    // Structure saved, but the postcode failed before addressLine1/addressPostalCode were stored.
    expect(
      onboardingResumeState({status: "PENDING", businessInfo: {legalBusinessName: "Acme", companyType: "COMPANY_LTD"}})
    ).toEqual({kind: "resume", step: 3});
  });

  it("treats a partial address as still incomplete", () => {
    expect(
      onboardingResumeState({
        status: "PENDING",
        businessInfo: {companyType: "CHARITY", addressLine1: "1 High St"} // postcode missing
      })
    ).toEqual({kind: "resume", step: 3});
  });

  it("is complete once structure and address are present (step 4 is optional)", () => {
    expect(
      onboardingResumeState({
        status: "PENDING",
        businessInfo: {companyType: "COMPANY_LTD", addressLine1: "1 High St", addressPostalCode: "SW1A 1AA"}
      })
    ).toEqual({kind: "complete"});
  });

  it("is locked once KYB has moved the business past PENDING/REJECTED/KYB_HOLD", () => {
    expect(
      onboardingResumeState({
        status: "IN_REVIEW",
        businessInfo: {companyType: "COMPANY_LTD", addressLine1: "1 High St", addressPostalCode: "SW1A 1AA"}
      })
    ).toEqual({kind: "locked", status: "IN_REVIEW"});
  });

  it("defaults a missing status to PENDING (editable)", () => {
    expect(onboardingResumeState({businessInfo: {}})).toEqual({kind: "resume", step: 2});
  });
});
