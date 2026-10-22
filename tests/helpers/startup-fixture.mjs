// UI fixtures already bypass authentication; expose the same explicit startup
// contract as the real service so browser regressions exercise the new gate.
export function startupFixture(path) {
  const welcome={revision:'fixture-welcome',welcome:{background:'builtin',desktopFocus:{x:50,y:50},mobileFocus:{x:36,y:50},shade:22,position:'right'}};
  if(path==='/api/bootstrap')return {...welcome,authenticated:true,authenticationRequired:true};
  if(path==='/api/settings/welcome')return welcome;
  return {revision:'fixture-access',authenticationRequired:true};
}
