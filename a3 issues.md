
## Issues 

edit box issues
- [ ] ctrl K works, y(ank) does not. 
- [ ] double click on a word does not select it. 
- [ ] shift arrows does not select. 
- [ ] program should be run through utilties.format_program to be "standardized" when loaded from an example.

layout issues 
- [ ] build|examples|log2|bs is just slightly too wide to fit on a phone screen. Could (a) not show log2 and bs value - just  reveal in dd, (b) only do that on a phone? (c) ?? your thoughts. I want that width to work on a phone
- [ ] likewise Info| ... is too wide and getting wider with density_df (see below). We can do Info|describe|plot|price|reins|more and more is dd stats|density|\<available for future use\> .

other issues
- [ ] building a distortion fails:  dist MYD ph .5 -> 402 return value? this works in jupyter lab to build. 
- [ ] this is a biggie: densities (displays density_df and sev_density_df go?!!!) Start with density_df only filter on p_total > 0. What options do we have to filter rows/colmns. practically speaking how large a df should we think of loading? Some selection here wd be good.  

## a4 next steps 
- [ ] filters on the tables - eg stats tables just show mean/cv/skew and meta rows
- [ ] hints over-ride args and give access to big log2: if i put a hints{bs=24;} on a decl program that overrides the default 0! 
- [ ] add  \_bs\_window_df under more on the info|... menu. 
- [ ] price: needs to have input boxes for p (probability level) and CoC (cost of capital) and LR (loss ratio). p required plus either CoC or LR. Then use the price_pentagon (eg p1.price_pentagon(p=0.99, LR=.9), p1.price_pentagon(p=0.99, ROE=.15)) to fill out the pricing. Display that returned dataframe. The rest is for Portfolio objects only. Run calibrate_distortions with the coc (roe) from the returned pentagon df and the same p. (FWIW port.calibration_df should then match the pentagon in the overlapping columns). Finally, run  ad = port.analyze_distortions(p=\<same p value\>)  and display ad.pricing_df.xs('LR', axis=0, level='stat') (numbers as percents) and ad.pricing_df.xs('P', axis=0, level='stat') (numbers as 0,.0f), xs('PQ'....) as 0.3f and ROE as 0.0%; there are a lot of other ways we could go but let's start with that.  

Finally, take a look at the aggregate matplotlib style, T:/worktrees/aggregate_REFACTOR/src/aggregate/data/aggregate.mplstyle. i want it to look more aligned with the site. ATM it has blue backgrounds, a serif font that is too big and just generally doesn't match. Can you propose something that does match - just drop it over the existing - its all in git and i have copied existing as .original. we can tinker with that. I will look in jupyter at what it produces. 


## Aggregate issues 
- [ ] info x-min / max uses 0,. something number format. 
- [ ] info - validation? 
- [ ] agg MYK 12 claims sev -0.5 * uniform - 2 poisson but  tester('agg MYK 12 claims sev -0.5 * uniform - 2 poisson', bs=1/32, log2=13) works - it is a bs issue 
