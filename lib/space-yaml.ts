/** Render the initial space.yaml seeded into a new space repo (ARCHITECTURE §2.1). */
export function renderSpaceYaml(input: { name: string; slug: string; owner: string }): string {
  return (
    [
      `name: ${input.name}`,
      `slug: ${input.slug}`,
      `owners: [${input.owner}]`,
      `write_back_default: auto_merge_clean`,
      `connectors: []`,
    ].join('\n') + '\n'
  )
}
