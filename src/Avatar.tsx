import { useState } from 'react';
import { UserCircleIcon } from '@phosphor-icons/react';
import { artworkUrl } from '../server/artwork-url';

export function Avatar({artwork,name,className='follow-avatar'}:{artwork?:string;name:string;className?:string}) {
  const [failed,setFailed]=useState(''),src=artworkUrl(artwork);
  return src&&src!==failed?<img className={className} src={src} alt={name+'的头像'} referrerPolicy="no-referrer" loading="lazy" onError={()=>setFailed(src)}/>:<span className={className+' unknown-cover'} aria-label={name+'的头像暂不可用'}><UserCircleIcon size={40}/></span>;
}
