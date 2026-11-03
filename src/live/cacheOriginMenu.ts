import { installCacheOriginMenu } from "../editor/cacheOriginBridge";
import { effectiveCachePolicy } from "../editor/cachePolicy";
import { coalesceRule } from "../sim/cachePresets";
import { t } from "../i18n";

installCacheOriginMenu((ctx) => {
  if (ctx.mode !== "live" || !ctx.edgeId) return [];
  const effective = effectiveCachePolicy(ctx.editor, ctx.edgeId);
  if (!effective?.editable) return [];
  if (effective.storing.length !== 1)
    return [
      {
        type: "item",
        id: "edge.cache-rules",
        label: t("cache.rules"),
        run: () => {
          ctx.editor.select({ nodeIds: [effective.node] });
          ctx.editor.openInspector("cache-add-rule");
        },
      },
    ];
  const rule = effective.storing[0],
    on = !!rule.policy.coalesce;
  return [
    {
      type: "item",
      id: "edge.coalesce",
      label: t("cache.coalescingAction", { mode: on ? "perRequest" : "coalesce" }),
      run: () => {
        const table = on
          ? rule.id === ""
            ? { ...effective.table, default: { ...rule.policy, coalesce: false } }
            : {
                ...effective.table,
                rules: effective.table.rules.map((r) =>
                  r.id === rule.id ? { ...r, policy: { ...r.policy, coalesce: false } } : r,
                ),
              }
          : coalesceRule(effective.table, rule.id);
        effective.set(table);
      },
    },
  ];
});
