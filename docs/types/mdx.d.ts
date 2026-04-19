declare module "*.md" {
  import type { MDXProps } from "mdx/types";
  const MDXContent: (props: MDXProps) => JSX.Element;
  export default MDXContent;
}
