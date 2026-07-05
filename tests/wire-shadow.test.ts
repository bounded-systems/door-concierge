import { expect, test } from "bun:test";
import { __setWireManifest, shadowCheckParams } from "../concierged.ts";

test("shadowCheckParams: log-only, warns on undeclared params, allows kind", () => {
  __setWireManifest({
    methods: ["register"],
    params: { register: ["capability", "door"] },
  });
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (m?: unknown) => void warns.push(String(m));
  try {
    shadowCheckParams("register", { kind: "register", capability: "c", door: "d" });
    expect(warns.length).toBe(0);
    shadowCheckParams("register", { capability: "c", bogusField: 1 });
    expect(warns.some((w) => w.includes("bogusField"))).toBe(true);
    shadowCheckParams("status", { anything: 1 });
  } finally {
    console.warn = orig;
    __setWireManifest(null);
  }
  shadowCheckParams("register", { whatever: 1 });
});
