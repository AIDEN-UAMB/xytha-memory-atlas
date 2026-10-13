import {ChartData,Scope,TransformationSource,scopeNames,scopeOrder,mutagenNames} from './chart-model';

// A source owns its four transformations. Natal star fields are never overwritten by a transit.
export function transformationSources(c:Omit<ChartData,'transformationSources'>,birthStemBranch:string):ChartData['transformationSources']{
 return Object.fromEntries(scopeOrder.map(scope=>{
  const natal=scope==='natal',overlay=natal?null:c.layers[scope],decade=scope==='decadal'?c.decades.find(d=>c.age>=d.ageRange[0]&&c.age<=d.ageRange[1]):undefined;
  const id=natal?`natal@${c.solarDate}`:`${scope}@${c.target}`;
  const stemBranch=natal?birthStemBranch:overlay!.heavenlyStem+overlay!.earthlyBranch;
  const childhood=scope==='decadal'&&overlay?.name==='童限';
  const source:TransformationSource={id,scope,label:natal?'生年四化':childhood?'童限四化':scopeNames[scope]+'四化',origin:natal?'出生年天干':childhood?'童限宫位天干':scope==='decadal'?'大限命宫天干':scopeNames[scope]+'天干',heavenlyStem:stemBranch[0]||'',stemBranch,fixed:natal,observedOn:natal?null:c.target,
   periodLabel:natal?`${stemBranch}生年 · 随出生资料固定`:decade?`${decade.ageRange.join('–')}虚岁 · 农历年${decade.yearRange.join('–')}`:`${childhood?'童限 · '+c.age+'虚岁':scopeNames[scope]} · ${stemBranch} · 观察日 ${c.target}`,
   ...(decade?{ageRange:decade.ageRange,yearRange:decade.yearRange}:{}),mutations:[]};
  for(const p of c.palaces)for(const star of [...p.majorStars,...p.minorStars,...p.adjectiveStars]){
   const value=natal?star.mutagen:mutagenNames[overlay!.mutagen.indexOf(star.name)];
   if(!mutagenNames.includes(value as typeof mutagenNames[number]))continue;
   source.mutations.push({id:`${id}/${star.name}:${value}`,sourceId:id,scope,value:value as typeof mutagenNames[number],star:star.name,palaceIndex:p.index,natalPalace:p.name,scopePalace:overlay?overlay.palaceNames[p.index]:p.name});
  }
  return [scope,source];
 })) as ChartData['transformationSources'];
}

export function evidenceSources(c:ChartData,scope:Scope){
 // An observation can compare its enclosing layers; natal evidence stays independent of observation date.
 return scopeOrder.slice(0,scopeOrder.indexOf(scope)+1).map(s=>c.transformationSources[s]);
}
