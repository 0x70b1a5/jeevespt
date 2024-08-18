import fs from "fs";

export const persist = (guildId: string, data: any) => {
  fs.writeFileSync(`data/${guildId}.json`, JSON.stringify(data));
};

export const load = (guildId: string) => {
  return JSON.parse(fs.readFileSync(`data/${guildId}.json`, "utf8"));
};