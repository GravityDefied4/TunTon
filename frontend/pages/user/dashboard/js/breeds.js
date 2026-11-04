/* Breed suggestions for the Breed field (shown through a <datalist>).
   Suggestions only: users can still type any breed. */
const BREEDS = {
  Dog: [
    'Aspin (Asong Pinoy)', 'Mixed breed', 'Unknown',
    'Affenpinscher', 'Afghan Hound', 'Airedale Terrier', 'Akita', 'Alaskan Malamute', 'American Bully',
    'American Bulldog', 'American Eskimo', 'American Pit Bull Terrier', 'American Staffordshire Terrier',
    'Australian Cattle Dog', 'Australian Shepherd', 'Basenji', 'Basset Hound', 'Beagle', 'Bernese Mountain Dog',
    'Bichon Frise', 'Border Collie', 'Boston Terrier', 'Boxer', 'Bulldog', 'Bull Terrier', 'Cairn Terrier',
    'Cane Corso', 'Cavalier King Charles Spaniel', 'Chihuahua', 'Chow Chow', 'Cocker Spaniel', 'Collie',
    'Corgi', 'Dachshund', 'Dalmatian', 'Doberman Pinscher', 'English Bulldog', 'English Springer Spaniel',
    'French Bulldog', 'German Shepherd', 'Golden Retriever', 'Great Dane', 'Greyhound', 'Havanese',
    'Husky (Siberian Husky)', 'Jack Russell Terrier', 'Japanese Spitz', 'Labrador Retriever', 'Lhasa Apso',
    'Maltese', 'Maltese Shih Tzu (Malshi)', 'Miniature Pinscher', 'Miniature Schnauzer', 'Newfoundland',
    'Papillon', 'Pekingese', 'Pit Bull', 'Pointer', 'Pomeranian', 'Poodle', 'Pug', 'Rottweiler', 'Saint Bernard',
    'Samoyed', 'Schnauzer', 'Shar Pei', 'Shiba Inu', 'Shih Tzu', 'Staffordshire Bull Terrier', 'Toy Poodle',
    'Vizsla', 'Weimaraner', 'West Highland White Terrier', 'Whippet', 'Yorkshire Terrier'
  ],
  Cat: [
    'Puspin (Pusang Pinoy)', 'Domestic shorthair', 'Domestic longhair', 'Mixed breed', 'Unknown',
    'Abyssinian', 'American Shorthair', 'Balinese', 'Bengal', 'Birman', 'Bombay', 'British Shorthair',
    'Burmese', 'Chartreux', 'Cornish Rex', 'Devon Rex', 'Egyptian Mau', 'Exotic Shorthair', 'Himalayan',
    'Maine Coon', 'Manx', 'Norwegian Forest Cat', 'Ocicat', 'Oriental Shorthair', 'Persian', 'Ragdoll',
    'Russian Blue', 'Scottish Fold', 'Siamese', 'Siberian', 'Singapura', 'Somali', 'Sphynx', 'Tonkinese',
    'Turkish Angora', 'Turkish Van'
  ]
};

/* Species name suggestions for the "What kind of animal?" field (species = Other) */
const OTHER_ANIMALS = ['Rabbit', 'Hamster', 'Guinea pig', 'Bird', 'Parrot', 'Lovebird', 'Cockatiel', 'Chicken', 'Duck',
  'Turtle', 'Tortoise', 'Lizard', 'Snake', 'Ferret', 'Pig', 'Goat'];

/* Breed / variety suggestions for some of those animals (keys are lowercase) */
const OTHER_BREEDS = {
  'rabbit': ['Netherland Dwarf', 'Holland Lop', 'Mini Rex', 'Lionhead', 'Flemish Giant', 'Dutch', 'Angora', 'Mixed breed', 'Unknown'],
  'hamster': ['Syrian', 'Dwarf Campbell', 'Roborovski', 'Winter White', 'Chinese', 'Mixed breed', 'Unknown'],
  'guinea pig': ['American', 'Abyssinian', 'Peruvian', 'Teddy', 'Skinny pig', 'Mixed breed', 'Unknown'],
  'bird': ['Canary', 'Finch', 'Lovebird', 'Cockatiel', 'Parakeet (Budgie)', 'Mynah', 'Unknown'],
  'parrot': ['African Grey', 'Macaw', 'Cockatoo', 'Eclectus', 'Conure', 'Amazon', 'Unknown'],
  'lovebird': ['Peach-faced', 'Fischer\'s', 'Masked', 'Unknown'],
  'cockatiel': ['Grey', 'Lutino', 'Pied', 'Pearl', 'Albino', 'Unknown'],
  'chicken': ['Native (Bisaya)', 'Bantam', 'Rhode Island Red', 'Leghorn', 'Fighting cock (Sabong)', 'Unknown'],
  'duck': ['Pekin', 'Muscovy', 'Mallard', 'Native (Itik)', 'Unknown'],
  'turtle': ['Red-eared slider', 'Painted turtle', 'Unknown'],
  'tortoise': ['Sulcata', 'Russian', 'Red-footed', 'Unknown'],
  'ferret': ['Standard', 'Unknown'],
  'pig': ['Native (Baboy damo)', 'Mini pig', 'Duroc', 'Landrace', 'Unknown'],
  'goat': ['Native', 'Boer', 'Anglo-Nubian', 'Saanen', 'Unknown']
};

/* Colors for "Other" animals (birds, reptiles, rabbits...): the wide list. */
const COLOR_SUGGESTIONS = [
  'Amber', 'Beige', 'Black', 'Blue', 'Brown', 'Chocolate', 'Cream', 'Golden', 'Gray', 'Green', 'Ginger',
  'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'Tabby', 'Tan', 'White', 'Yellow'
];

/* Real coat colors for dogs and cats, so nobody picks a blue dog or a green cat.
   (Dogs and cats that look blue are really Gray, which is on both lists.) One word each, because a space makes a new tag. */
const COLORS_BY_SPECIES = {
  Dog: ['Black', 'Brown', 'Brindle', 'Chocolate', 'Cream', 'Fawn', 'Golden', 'Gray', 'Merle', 'Red', 'Silver', 'Spotted', 'Tan', 'White', 'Yellow'],
  Cat: ['Black', 'Brown', 'Calico', 'Chocolate', 'Cream', 'Ginger', 'Gray', 'Orange', 'Silver', 'Tabby', 'Tortoiseshell', 'Tuxedo', 'White']
};

/* Species-specific coat/feather/scale colors. These are suggestions, not a claim that
   every animal of that species can have every listed color. Keep names aligned with the
   shared colors lookup so reports can be saved and matched consistently. */
const COLORS_BY_OTHER_SPECIES = {
  rabbit: ['Black', 'Brown', 'Chocolate', 'Cream', 'Fawn', 'Golden', 'Gray', 'Orange', 'Silver', 'Tan', 'White'],
  hamster: ['Black', 'Brown', 'Cream', 'Golden', 'Gray', 'Orange', 'White'],
  'guinea pig': ['Black', 'Brown', 'Cream', 'Golden', 'Gray', 'Orange', 'Red', 'White'],
  bird: ['Black', 'Blue', 'Brown', 'Gray', 'Green', 'Orange', 'Red', 'White', 'Yellow'],
  parrot: ['Black', 'Blue', 'Green', 'Gray', 'Orange', 'Red', 'White', 'Yellow'],
  lovebird: ['Blue', 'Green', 'Orange', 'Red', 'White', 'Yellow'],
  cockatiel: ['Gray', 'Yellow', 'White', 'Orange', 'Cream'],
  chicken: ['Black', 'Brown', 'Gray', 'Orange', 'Red', 'White', 'Yellow'],
  duck: ['Black', 'Brown', 'Gray', 'Green', 'White', 'Yellow'],
  turtle: ['Black', 'Brown', 'Gray', 'Green', 'Orange', 'Yellow'],
  tortoise: ['Black', 'Brown', 'Cream', 'Gray', 'Tan', 'Yellow'],
  lizard: ['Black', 'Brown', 'Gray', 'Green', 'Orange', 'Red', 'Tan', 'Yellow'],
  snake: ['Black', 'Brown', 'Cream', 'Gray', 'Green', 'Orange', 'Red', 'White', 'Yellow'],
  ferret: ['Black', 'Brown', 'Chocolate', 'Cream', 'Gray', 'Silver', 'White'],
  pig: ['Black', 'Brown', 'Gray', 'Pink', 'Red', 'White'],
  goat: ['Black', 'Brown', 'Cream', 'Gray', 'Red', 'Tan', 'White']
};

/* The broad list is used before an animal is specified, and as a fallback for an
   unlisted animal entered under Other. */
function colorsFor(species, otherSpecies = '') {
  if (COLORS_BY_SPECIES[species]) return COLORS_BY_SPECIES[species];
  const animal = String(species === 'Other' ? otherSpecies : species || '').trim().toLowerCase();
  return COLORS_BY_OTHER_SPECIES[animal] || COLOR_SUGGESTIONS;
}
