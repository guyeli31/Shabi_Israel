-- "איפה יאירי" (spot it, quiz GevKahoot): its picture media/images/אש אחי.jpg was
-- cropped to the people — 8% off the left (10% would have touched the left-most
-- person), 10% off the top, the right and the bottom: 2048×1530 → 1679×1224
-- (pixels 164-1843 × 153-1377). The rectangles are fractions of the picture, so
-- each is moved and scaled to the same people in the new frame:
--   x' = (x·2048 − 164) / 1679     w' = w·2048 / 1679
--   y' = (y·1530 − 153) / 1224     h' = h·1530 / 1224
-- All eleven fall inside the crop; their order (region N = option N) and the
-- right one (`correct` = {0}) are unchanged.
--
-- Guarded by the OLD rectangles: it changes the question only while it still
-- holds exactly those, so a second run (or a question edited since) is left
-- alone. Re-runnable.

update public.gk_items
   set regions = '[{"h":0.3472,"w":0.1677,"x":0.8089,"y":0.5063},{"h":0.2604,"w":0.4525,"x":0.2519,"y":0.6495},{"h":0.3994,"w":0.1836,"x":0.0367,"y":0.0983},{"h":0.3863,"w":0.1487,"x":0.214,"y":0.12},{"h":0.3039,"w":0.155,"x":0.3468,"y":0.2024},{"h":0.2778,"w":0.0981,"x":0.5114,"y":0.2068},{"h":0.3429,"w":0.1108,"x":0.6064,"y":0.2155},{"h":0.23,"w":0.1298,"x":0.7265,"y":0.2501},{"h":0.3213,"w":0.0728,"x":0.714,"y":0.4889},{"h":0.3213,"w":0.1392,"x":0.0715,"y":0.5063},{"h":0.1606,"w":0.405,"x":0.2583,"y":0.4715}]'::jsonb
 where kind = 'spot'
   and image = 'media/images/אש אחי.jpg'
   and regions = '[{"h":0.2778,"w":0.1375,"x":0.7432,"y":0.505},{"h":0.2083,"w":0.371,"x":0.2866,"y":0.6196},{"h":0.3195,"w":0.1505,"x":0.1102,"y":0.1786},{"h":0.309,"w":0.1219,"x":0.2555,"y":0.196},{"h":0.2431,"w":0.1271,"x":0.3644,"y":0.2619},{"h":0.2222,"w":0.0804,"x":0.4993,"y":0.2654},{"h":0.2743,"w":0.0908,"x":0.5772,"y":0.2724},{"h":0.184,"w":0.1064,"x":0.6757,"y":0.3001},{"h":0.257,"w":0.0597,"x":0.6654,"y":0.4911},{"h":0.257,"w":0.1141,"x":0.1387,"y":0.505},{"h":0.1285,"w":0.332,"x":0.2918,"y":0.4772}]'::jsonb;

-- What it holds now (expect the new rectangles: the first starts at x 0.8089).
select title, regions -> 0 as first_region, jsonb_array_length(regions) as regions, correct
  from public.gk_items
 where kind = 'spot' and image = 'media/images/אש אחי.jpg';
