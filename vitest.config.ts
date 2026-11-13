import { defineConfig } from "vitest/config";

// GAS のスクリプトのタイムゾーン（Asia/Tokyo）とそろえる
process.env.TZ = "Asia/Tokyo";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
