-- Seed the question bank with real 11+ style maths questions.
-- Idempotent: only seeds when the table is empty.

DO $$
BEGIN
IF (SELECT count(*) FROM questions) = 0 THEN

  INSERT INTO questions (text, options, correct_index, topic, difficulty) VALUES
  -- Number
  ('What is 4,096 ÷ 8?', '["502","512","514","612"]'::jsonb, 1, 'number', 2),
  ('What is the value of 7³?', '["21","49","243","343"]'::jsonb, 3, 'number', 2),
  ('Round 48,627 to the nearest thousand.', '["48,000","48,600","49,000","50,000"]'::jsonb, 2, 'number', 2),
  ('Which of these is a prime number?', '["51","57","59","63"]'::jsonb, 2, 'number', 3),
  ('What is the next number in the sequence: 2, 6, 18, 54, ...?', '["108","162","148","216"]'::jsonb, 1, 'number', 3),
  ('Calculate 1,000 − 367.', '["633","733","643","637"]'::jsonb, 0, 'number', 1),

  -- Fractions, decimals & percentages
  ('What is 3/4 of 60?', '["40","45","48","50"]'::jsonb, 1, 'fractions_decimals_percentages', 2),
  ('Write 0.65 as a percentage.', '["6.5%","65%","0.65%","650%"]'::jsonb, 1, 'fractions_decimals_percentages', 1),
  ('What is 25% of 240?', '["50","60","65","70"]'::jsonb, 1, 'fractions_decimals_percentages', 2),
  ('Which fraction is equal to 0.2?', '["1/2","1/4","1/5","2/5"]'::jsonb, 2, 'fractions_decimals_percentages', 2),
  ('What is 1/2 + 1/3?', '["2/5","5/6","3/5","1/6"]'::jsonb, 1, 'fractions_decimals_percentages', 3),
  ('Increase £80 by 15%.', '["£88","£92","£95","£96"]'::jsonb, 1, 'fractions_decimals_percentages', 3),

  -- Ratio & proportion
  ('Share £45 in the ratio 2:3. What is the larger share?', '["£18","£27","£30","£25"]'::jsonb, 1, 'ratio_proportion', 3),
  ('A recipe uses 2 eggs for 4 people. How many eggs are needed for 10 people?', '["4","5","6","8"]'::jsonb, 1, 'ratio_proportion', 2),
  ('Simplify the ratio 12:18.', '["2:3","3:4","4:6","6:9"]'::jsonb, 0, 'ratio_proportion', 2),
  ('If 3 pens cost 90p, how much do 7 pens cost?', '["£1.80","£2.10","£2.40","£2.70"]'::jsonb, 1, 'ratio_proportion', 2),
  ('A map has a scale of 1:50,000. How far in real life is 2 cm on the map?', '["0.5 km","1 km","5 km","10 km"]'::jsonb, 1, 'ratio_proportion', 4),
  ('Paint is mixed in the ratio 5:2 (blue:white). With 10 litres of blue, how much white is needed?', '["2 L","4 L","5 L","6 L"]'::jsonb, 1, 'ratio_proportion', 3),

  -- Algebra
  ('If x + 7 = 12, what is x?', '["4","5","6","19"]'::jsonb, 1, 'algebra', 1),
  ('Solve 3y = 21.', '["6","7","8","18"]'::jsonb, 1, 'algebra', 1),
  ('If 2a − 3 = 11, what is a?', '["4","6","7","8"]'::jsonb, 2, 'algebra', 2),
  ('What is the value of 4n + 2 when n = 5?', '["20","22","24","18"]'::jsonb, 1, 'algebra', 2),
  ('Simplify 5x + 3x − 2x.', '["6x","8x","10x","4x"]'::jsonb, 0, 'algebra', 2),
  ('If p = 3 and q = 4, what is 2p + 3q?', '["14","16","18","20"]'::jsonb, 2, 'algebra', 3),

  -- Geometry
  ('How many degrees are there in a right angle?', '["45","90","180","360"]'::jsonb, 1, 'geometry', 1),
  ('What is the area of a rectangle that is 8 cm by 5 cm?', '["13 cm²","40 cm²","26 cm²","45 cm²"]'::jsonb, 1, 'geometry', 1),
  ('The angles inside a triangle add up to how many degrees?', '["90°","180°","270°","360°"]'::jsonb, 1, 'geometry', 1),
  ('A square has a perimeter of 36 cm. How long is one side?', '["6 cm","8 cm","9 cm","12 cm"]'::jsonb, 2, 'geometry', 2),
  ('How many faces does a cuboid have?', '["4","5","6","8"]'::jsonb, 2, 'geometry', 2),
  ('What is the area of a triangle with a base of 10 cm and a height of 6 cm?', '["30 cm²","60 cm²","16 cm²","32 cm²"]'::jsonb, 0, 'geometry', 3),

  -- Data handling
  ('What is the mean (average) of 4, 8, 6 and 2?', '["4","5","6","20"]'::jsonb, 1, 'data_handling', 2),
  ('What is the mode of 3, 7, 3, 9, 3 and 5?', '["3","5","7","9"]'::jsonb, 0, 'data_handling', 1),
  ('What is the median of 2, 5, 9, 11 and 14?', '["5","9","11","7"]'::jsonb, 1, 'data_handling', 2),
  ('What is the range of 12, 7, 19 and 4?', '["12","15","19","23"]'::jsonb, 1, 'data_handling', 2),
  ('A spinner has 4 equal sections, one of which is red. What is the probability of landing on red?', '["1/2","1/3","1/4","1/5"]'::jsonb, 2, 'data_handling', 2),
  ('On a bar chart, Monday is 10, Tuesday is 15 and Wednesday is 5. What is the total?', '["25","30","35","20"]'::jsonb, 1, 'data_handling', 2);

END IF;
END $$;
