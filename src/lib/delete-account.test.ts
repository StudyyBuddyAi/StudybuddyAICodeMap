import { describe, expect, it, vi } from "vitest";
import {
  DELETE_CONFIRMATION,
  handleDeleteAccount,
  type DeleteAccountDeps,
} from "../../supabase/functions/_shared/delete-account";

function deps(overrides: Partial<DeleteAccountDeps> = {}): DeleteAccountDeps {
  return {
    userFromToken: vi.fn(async (token: string) => (token === "good" ? { id: "user-1" } : null)),
    deleteUser: vi.fn(async () => ({ error: null })),
    log: vi.fn(),
    ...overrides,
  };
}

const confirmed = { confirm: DELETE_CONFIRMATION };

describe("handleDeleteAccount", () => {
  it("deletes the caller's own account when confirmed", async () => {
    const d = deps();
    const result = await handleDeleteAccount("Bearer good", confirmed, d);
    expect(result).toEqual({ status: 200, body: { deleted: true } });
    expect(d.deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("refuses without a valid token, and deletes nothing", async () => {
    for (const header of [null, "", "Bearer ", "Bearer bad"]) {
      const d = deps();
      const result = await handleDeleteAccount(header, confirmed, d);
      expect(result).toEqual({ status: 401, body: { error: "invalid_token" } });
      expect(d.deleteUser).not.toHaveBeenCalled();
    }
  });

  it("refuses without the confirmation word", async () => {
    for (const body of [null, {}, { confirm: "delete" }, { confirm: true }, "DELETE"]) {
      const d = deps();
      const result = await handleDeleteAccount("Bearer good", body, d);
      expect(result).toEqual({ status: 400, body: { error: "confirmation_required" } });
      expect(d.deleteUser).not.toHaveBeenCalled();
    }
  });

  it("reports a failed delete without leaking the cause", async () => {
    const d = deps({ deleteUser: vi.fn(async () => ({ error: "db timeout" })) });
    const result = await handleDeleteAccount("Bearer good", confirmed, d);
    expect(result).toEqual({ status: 500, body: { error: "delete_failed" } });
    expect(d.log).toHaveBeenCalledWith("delete_failed", { error: "db timeout" });
  });
});
