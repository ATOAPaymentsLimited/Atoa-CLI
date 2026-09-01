import {defineCommand} from "citty";
import {t} from "../lib/i18n";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "./_common";

type GetArgs = CommonOptions & {path?: string; pageAll?: boolean};
import {parseFieldArgs, resolvePathAndQuery} from "../lib/request-utils";
import {walkAllPages} from "../lib/pagination";

const DEFAULT_PAGE_SIZE = 20;

export default defineCommand({
  meta: {name: "get", description: t("cmdGet")},
  args: withCommonArgs({
    path: {type: "positional", required: true, description: t("argApiPath")},
    pageAll: {type: "boolean", description: t("argPageAll")}
  }),
  // SDK-key authenticated, like the other raw-request commands: these are for poking the API
  // with a minted key, not for driving the browser-login session.
  run: runWithSdkKey<GetArgs>(async (ctx, args, rawArgs) => {
    const fields = parseFieldArgs(rawArgs);
    const {resolvedPath, query} = resolvePathAndQuery(args.path as string, fields);

    if (ctx.dryRun) {
      ctx.print({method: "GET", url: ctx.http.baseUrl + resolvedPath, query});
      return;
    }

    if (args.pageAll) {
      const size = Number(query.size ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
      const results = await walkAllPages({
        pageSize: size,
        fetchPage: async (page) => {
          const {data} = await ctx.http.request({
            method: "GET",
            path: resolvedPath,
            query: {...query, page: String(page), size: String(size)}
          });
          return data;
        }
      });
      ctx.print(results);
    } else {
      const {data} = await ctx.http.request({method: "GET", path: resolvedPath, query});
      ctx.print(data);
    }
  })
});
