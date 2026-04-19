import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
};

const withMDX = createMDX();

export default withMDX(config);
