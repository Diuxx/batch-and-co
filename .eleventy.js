module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addWatchTarget("./data/prices.json");
  eleventyConfig.addWatchTarget("./data/ingredients.json");
  eleventyConfig.addWatchTarget("./data/recipes.json");
  eleventyConfig.addFilter("json", value => JSON.stringify(value).replace(/</g, "\\u003c"));
  return {
    templateFormats: ["njk"],
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    htmlTemplateEngine: "njk"
  };
};
