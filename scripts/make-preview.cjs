/* Aperçu statique hors Eleventy, pour tests locaux lorsque npm n'est pas disponible. */
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const src=path.join(root,'src');const out=path.join(root,'preview');
const catalog=require(path.join(src,'_data/catalog.js'))();
const read=file=>fs.readFileSync(path.join(src,file),'utf8');
const renderIncludes=content=>content.replace(/\{% include "([^"]+)" %\}/g,(_,name)=>renderIncludes(read('_includes/'+name)));
let index=read('index.njk').replace(/^---[\s\S]*?---\n/,'');
index=renderIncludes(index).replace(/{{ catalog\.pricing\.checkedAt }}/g,catalog.pricing.checkedAt);
let layout=read('_includes/layouts/base.njk').replace('{{ title }}','Batch & Co — Planning de repas').replace('{{ content | safe }}',index);
layout=layout.replace('{{ catalog | json | safe }}',JSON.stringify(catalog).replace(/</g,'\\u003c'));
fs.mkdirSync(path.join(out,'assets/css'),{recursive:true});
fs.mkdirSync(path.join(out,'assets/js'),{recursive:true});
fs.copyFileSync(path.join(src,'assets/css/main.css'),path.join(out,'assets/css/main.css'));
fs.copyFileSync(path.join(src,'assets/js/app.js'),path.join(out,'assets/js/app.js'));
fs.copyFileSync(path.join(src,'assets/js/domain.mjs'),path.join(out,'assets/js/domain.mjs'));
fs.writeFileSync(path.join(out,'index.html'),layout);
console.log('Static preview ready:',path.join(out,'index.html'));
