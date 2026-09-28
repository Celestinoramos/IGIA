import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "./helpers";

describe("lead import parsing", () => {
  it("reads a CSV with PT headers, quotes and semicolons", async () => {
    const { parseLeadImport } = await import("@/features/campaigns/import");
    const { profiles, errors } = parseLeadImport(
      [
        "Handle;Nome;Bio;Seguidores;Cidade;Hashtags",
        '@Loja_Da_Bela;Loja da Bela;"Roupas; acessórios • dona Bela";3,2k;São Paulo;#moda loja',
        "https://www.instagram.com/burger.house/?hl=pt;Burger House;delivery;12.500;;",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      instagramHandle: "@loja_da_bela",
      displayName: "Loja da Bela",
      bio: "Roupas; acessórios • dona Bela",
      followerCount: 3200,
      location: "São Paulo",
      hashtags: ["moda", "loja"],
    });
    expect(profiles[1]).toMatchObject({ instagramHandle: "@burger.house", followerCount: 12500, location: null });
  });

  it("reads a plain list, drops in-file duplicates and reports bad lines", async () => {
    const { parseLeadImport } = await import("@/features/campaigns/import");
    const { profiles, errors } = parseLeadImport("@um\num\n\nnao é perfil\n@dois\n");
    expect(profiles.map((p) => p.instagramHandle)).toEqual(["@um", "@dois"]);
    expect(errors).toEqual(['Linha 3: perfil inválido "nao é perfil".']);
  });

  it("rejects a CSV without a handle column", async () => {
    const { parseLeadImport } = await import("@/features/campaigns/import");
    const { profiles, errors } = parseLeadImport("nome,bio\nLoja,roupas");
    expect(profiles).toHaveLength(0);
    expect(errors[0]).toMatch(/coluna/);
  });

  it("caps the number of lines per import", async () => {
    const { parseLeadImport, MAX_IMPORT_ROWS } = await import("@/features/campaigns/import");
    const text = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `@perfil${i}`).join("\n");
    const { profiles, errors } = parseLeadImport(text);
    expect(profiles).toHaveLength(MAX_IMPORT_ROWS);
    expect(errors).toHaveLength(1);
  });
});

describe("lead import into a funnel", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("qualifies on-ICP profiles and queues first contact; low scores stay discovered", async () => {
    const { parseLeadImport } = await import("@/features/campaigns/import");
    const { discoverLeads } = await import("@/features/campaigns/discovery");
    const { profiles } = parseLeadImport("handle,nome,bio\n@loja_bela,Loja da Bela,loja de moda da dona Bela\n@aleatorio,,");
    const result = discoverLeads("customer", profiles, { source: "import" });
    expect(result).toMatchObject({ discovered: 2, qualified: 1 });

    const { getLeadByHandle } = await import("@/features/leads/repo");
    expect(getLeadByHandle("@loja_bela")!).toMatchObject({ pipelineState: "qualified", source: "import" });
    expect(getLeadByHandle("@aleatorio")!.pipelineState).toBe("discovered");
    const { listJobs } = await import("@/worker/queue");
    expect(listJobs().filter((j) => j.type === "first_contact")).toHaveLength(1);
  });

  it("qualifies every new lead of a vetted list, but still honors the blocklist", async () => {
    const { addToBlocklist, getLeadByHandle } = await import("@/features/leads/repo");
    addToBlocklist("@saiu", "prior_opt_out");
    const { parseLeadImport } = await import("@/features/campaigns/import");
    const { discoverLeads } = await import("@/features/campaigns/discovery");
    const { profiles } = parseLeadImport("@aleatorio\n@saiu");
    const result = discoverLeads("customer", profiles, { source: "import", qualifyAll: true });
    expect(result).toMatchObject({ discovered: 1, qualified: 1, blocked: 1 });
    expect(getLeadByHandle("@aleatorio")!.pipelineState).toBe("qualified");
    expect(getLeadByHandle("@saiu")).toBeNull();
  });
});
