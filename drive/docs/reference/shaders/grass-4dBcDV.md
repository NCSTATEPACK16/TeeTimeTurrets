# Grass shader candidate: Shadertoy 4dBcDV

Saved Oct 18, 2026 as a **possible** reference for M4 grass. Nothing uses it yet.
Source: <https://www.shadertoy.com/view/4dBcDV>, pasted by the user (the page is blocked from the cloud).
The clouds are credited inside the code to drift, <https://www.shadertoy.com/view/4tdSWr>.

## Before using it
- **License unknown.** Shadertoy's default license is CC BY-NC-SA 3.0 (non-commercial, share-alike)
  unless the author states otherwise. Check the page header before porting, and add the notice to
  `ATTRIBUTION.md` if it's used, as was done for the afl_ext water.
- **Only the Image pass was saved.** It reads three buffer passes that are not here:
  - `iChannel0`: the grass texture (blade masks and colors in a 256 px tile, plus a far-distance LOD
    strip). This is where the blades themselves are drawn.
  - `iChannel1`: camera state (rotation in pixel 1, position in pixel 3), i.e. mouse/keyboard fly-cam.
  - `iChannel2`: a 64 px velocity field that bends the blades (wind, possibly interaction).
  Save the Buffer A/B/C code too if we go ahead; without iChannel0 there is no grass to port.

## How it works
- **Layered shells.** The ground is a plane. For each pixel the ray is intersected with 70 horizontal
  slices from 0 to HEIGHT; each slice samples the blade texture and blends in where the blade mask is
  solid. Higher slices are lighter (fake AO, `DARKNESS`) and tips are tinted.
- **Wind** offsets each slice's lookup by the velocity field, scaled by height², so tips sway most.
- **Distance:** past `DISTANCE` (50 m) it shows a cheap texture LOD tinted by `FARDARK`, and it fades
  the blades out toward that distance.
- Per-pixel jitter of the slice height hides banding.

## Fit with the PRD (M4 "Grass" row)
- The shell idea ports well to a raster engine: draw N stacked copies of the terrain within ~50 m, each
  lifted by `h * HEIGHT`, with a TSL fragment shader that samples the blade mask and discards gaps.
  That gives the same look without raymarching, and it follows real terrain, not a flat plane.
- It is an alternative to the PRD's instanced blade geometry: cheaper for dense lawns (fairway, green),
  weaker for tall rough seen edge-on. Cart tracks would come from writing into the velocity/flatten field.
- `DISTANCE` 50 matches the PRD's ~50 m grass radius. Tunables would go in a config file, as with water.
- The sky/clouds part overlaps M3's sky (web-ocean port) and probably isn't wanted.

## Image pass (as pasted)

```glsl
//The more layers, the higher the quality
//Try higher values if your computer can take it
#define LAYERS 70
//Draw distance of the grass
#define DISTANCE 50.

//Height darkening of grass(to approximate AO)
#define DARKNESS .15
//Darkening factor for far distance, where grass is not drawn
#define FARDARK vec3(.87,.59, .78)

//Higher values make grass blades thinner and spaced closer together
//Set to 2.0 for hilarious chubby grass blades
#define SCALING 18.
//Height of grass
#define HEIGHT 1.



//Field of view
#define FOV (3.14159/3.)



//Credit to drift for the clouds:
//https://www.shadertoy.com/view/4tdSWr


const float cloudscale = 1.6;
const float speed = 0.02;
const float clouddark = 0.5;
const float cloudlight = 0.3;
const float cloudcover = 0.2;
const float cloudalpha = 8.0;
const float skytint = 0.5;
const vec3 skycolour1 = vec3(0.2, 0.4, 0.6);
const vec3 skycolour2 = vec3(0.4, 0.7, 1.0);

const mat2 m = mat2( 1.6,  1.2, -1.2,  1.6 );

vec2 hash( vec2 p ) {
	p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
	return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}

float noise( in vec2 p ) {
    const float K1 = 0.366025404; // (sqrt(3)-1)/2;
    const float K2 = 0.211324865; // (3-sqrt(3))/6;
	vec2 i = floor(p + (p.x+p.y)*K1);	
    vec2 a = p - i + (i.x+i.y)*K2;
    vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0); //vec2 of = 0.5 + 0.5*vec2(sign(a.x-a.y), sign(a.y-a.x));
    vec2 b = a - o + K2;
	vec2 c = a - 1.0 + 2.0*K2;
    vec3 h = max(0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
	vec3 n = h*h*h*h*vec3( dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
    return dot(n, vec3(70.0));	
}

float fbm(vec2 n) {
	float total = 0.0, amplitude = 0.1;
	for (int i = 0; i < 7; i++) {
		total += noise(n) * amplitude;
		n = m * n;
		amplitude *= 0.4;
	}
	return total;
}


#define HALF_PI 1.5707963267948966

float sineOut(float t) {
  return sin(t * HALF_PI);
}

float cubicOut(float t) {
  float f = t - 1.0;
  return f * f * f + 1.0;
}

float easeWhite(float x){
  if(x > sqrt(3.)/2.){
    float temp = (2.*x-2.);
    return 1. - temp*temp;
  }else{
    return x * 1.0717968;
  }
}

float easeIn(float t, float b, float strength){
    float a = 1./ (2.*b - b*b);
    if(t<=b) return mix(t, a*t*t, strength);
    
    else return mix(t, mix(a*b*b, 1., (t-b)/(1.-b)), strength);
}

// -----------------------------------------------

void clouds( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 p = fragCoord.xy*4.;
	vec2 uv = p;    
    float time = iTime * speed;
    float q = fbm(uv * cloudscale * 0.5);
    
    //ridged noise shape
	float r = 0.0;
	uv *= cloudscale;
    uv -= q - time;
    float weight = 0.8;
    for (int i=0; i < 11; i++){
		r += abs(weight*noise( uv ));
        uv = m*uv + time;
		weight *= i >=6 ? .56 : .7;
    }
  //if(iMouse.z <= 0.) r -= .04;  //TRYTHIS
     r *= .984;
    //noise shape
	float f = 0.0;
    uv = p;
	uv *= cloudscale;
    uv -= q - time;
    weight = 0.7;
    for (int i=0; i<13; i++){
		f += weight*noise( uv );
        uv = m*uv + time;
		weight *= 0.6;
    }
    
    f *= r + f;
    
    //noise colour
    float c = 0.0;
    time = iTime * speed * 2.0;
    uv = p*vec2(iResolution.x/iResolution.y,1.0);
	uv *= cloudscale*2.0;
    uv -= q - time;
    weight = 0.4;
    for (int i=0; i<7; i++){
		c += weight*noise( uv );
        uv = m*uv + time;
		weight *= 0.6;
    }
    
    //noise ridge colour
    float c1 = 0.0;
    time = iTime * speed * 3.0;
    uv = p*vec2(iResolution.x/iResolution.y,1.0);
	uv *= cloudscale*3.0;
    uv -= q - time;
    weight = 0.4;
    for (int i=0; i<7; i++){
		c1 += abs(weight*noise( uv ));
        uv = m*uv + time;
		weight *= 0.6;
    }
	
    c += c1;
    
    vec3 skycolour = mix(skycolour2, skycolour1, 2.3-2.*sqrt(length(p)));
    vec3 cloudcolour = vec3(1.1, 1.1, 0.9) * clamp((clouddark + cloudlight*c), 0.0, 1.0);
   
    f = cloudcover + cloudalpha*f*r;
    
    vec3 result;
    
    float fc = max(0., f+c) * 2.;
    
    
    //if(iMouse.z > 0.) result = mix(skycolour, clamp(skytint * skycolour + cloudcolour, 0.0, 1.0), cubicOut(clamp((f + c)*.5, 0.0, 1.0)));
    /*else*/  result = mix(skycolour, clamp(skytint * skycolour + cloudcolour, 0.0, 1.0),
                       easeIn( easeWhite(min(1.,1.07* fc / (1. +fc))), .35, .65 )   );
	fragColor = vec4( result, 1.0 );
}







//simple nonlinear function for hashing
float curve(float x)
{
     return x * (x*x + 3.0);
}

#define HASHSCALE (2.711651661)

float rand(vec2 p) {
    p = fract(p*HASHSCALE);
    return fract(curve( p.x + p.y * .618034) * 43758.5453);
}

#define PREVIEWSCALE (iResolution.y > 271. ? 1. : .5)
    
vec4 sampleGrass(vec2 uv, float h) {
    uv /= PREVIEWSCALE;
    vec2 uv2 = uv*.75 + vec2(float(iFrame) * .053)+.5;
    uv2 = floor(uv2) + smoothstep(0.,1., fract(uv2));
    uv2 -= .5;
    
    vec2 offs = texture(iChannel2, uv2/64. ).xy - vec2(.25); 
    //Use this line to debug velocity field
    //return vec4(offs,0.,1.);
    
    uv += .65*offs.xy* h * (h*.7+.3);
    
    uv /= iResolution.xy;
    uv *= PREVIEWSCALE * SCALING;
    uv = mod(uv,(PREVIEWSCALE * 256.)/iResolution.xy);
    uv += 4./iResolution.xy;
	return texture(iChannel0, uv);    
}

vec3 sampleGrassLOD(vec2 uv){
    uv /= 100. * iResolution.xy * PREVIEWSCALE;;
    uv *= PREVIEWSCALE * 1800.;
    uv = mod(uv,PREVIEWSCALE * 256./iResolution.xy);
    uv += 1./iResolution.xy;
    
    uv /= 8.;
    uv.x += PREVIEWSCALE * 400./iResolution.x;
    
    return texture(iChannel0,uv).xyz;
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    /*
    vec3 c = texture(iChannel0, fragCoord/iResolution.xy).xyz;
    fragColor = vec4(c, 1.);
    return;
    */
    
    vec3 rd = normalize(vec3( (fragCoord.xy*2. - iResolution.xy)/iResolution.x, FOV )); 
    vec4 tm = texture( iChannel1, vec2(1.5,.5)/iResolution.xy); 
    rd.zy = rd.zy * tm.x + rd.yz * vec2(tm.z, -tm.z);
    rd.xz = rd.xz * tm.y + rd.zx * vec2(tm.w, -tm.w);
	vec3 ro = texture( iChannel1, vec2(3.5,.5)/iResolution.xy).xyz;
    
    vec3 campos = ro.xzy;
    campos.z += 4.;
    vec3 raydir = rd.xzy;
    
    float tHit = -campos.z/raydir.z;
    
    //campos.z + t*raydir.z = h
    //t = (h - campos.z)/raydir.z
    
    if(tHit < 0.){ 
        vec3 dir2 = normalize(raydir + vec3(0.,0.,.1));
            
        float t = 1./dir2.z;
        vec2 uv = dir2.xy*t;

        vec4 skycol;

        clouds(skycol, uv/24.);

        fragColor = skycol;
        return;
    }else{
        
        
        vec3 hitBottom = campos + raydir *tHit;
        
        
        vec3 botCol = sampleGrassLOD(hitBottom.xy) * FARDARK;
        
        if(tHit > DISTANCE){
            fragColor = vec4(vec3(1.1,1.3,1.1)*botCol,1.);
            return;
        }
        
        vec3 col =  sampleGrass(hitBottom.xy, 0.).xyz * DARKNESS;
        
        for(int i=1; i<=LAYERS; i++){
            float h = float(i)/float(LAYERS);
            h += (rand(fragCoord) -.5)/float(LAYERS);

			float t = (h*HEIGHT-campos.z)/raydir.z;

            if(t<0.) continue;

            vec3 hit = campos + raydir * t;

            vec4 s = sampleGrass(hit.xy, h);
            
            float tip = min(1., h+.2);
           
            s.rgb = mix(s.rgb, min(vec3(1.), s.rgb*vec3(16.,1.5,2.8)), .8*pow(tip, 6.));
            
            s.a *= 1.-h;
            //s.a = smoothstep(.1,.2,s.a);
            s.a = 1.-pow(1.-smoothstep(.12,.2,s.a), 100./float(LAYERS));

            s.rgb *= mix(h,1.,DARKNESS);
            col = mix(col, s.rgb, s.a*.5);

        }
        
        float fac = tHit/DISTANCE;
        fac = fac*fac;
        fac = max(0., 1.-fac);
        
        fragColor = vec4(vec3(1.1,1.3,1.1)*mix(botCol, col, fac),1.);
    }
    
    
    
	//fragColor = texture(iChannel0, uv);
}
```
